// LLM proxy: lets people use the app without their own API key, with the server's key from .env.
//   GET  /llm            → {providers: {deepseek, anthropic}, models, code, left}   (what the server offers)
//   POST /llm/deepseek   → body as for api.deepseek.com/chat/completions, answer passed through
//   POST /llm/anthropic  → body as for api.anthropic.com/v1/messages, answer passed through
// Guards: allowed Origin, optional access code, model allowlist, max_tokens cap, a daily cap for everyone, a per-IP rate.
// ponytail: counters live in memory, so a restart resets today's count; persist them if restarts become frequent.
import crypto from 'node:crypto';

const env = process.env;
const PROVIDERS = {
  deepseek: { url: 'https://api.deepseek.com/chat/completions', key: env.DEEPSEEK_API_KEY, auth: k => ({ authorization: `Bearer ${k}` }) },
  anthropic: { url: 'https://api.anthropic.com/v1/messages', key: env.ANTHROPIC_API_KEY, auth: k => ({ 'x-api-key': k, 'anthropic-version': '2023-06-01' }) },
};
const MODELS = (env.LLM_MODELS || 'deepseek-flash,deepseek-v4-pro').split(',').map(s => s.trim()).filter(Boolean);
const CODE = env.LLM_ACCESS_CODE || '';
const DAILY_LIMIT = +env.LLM_DAILY_LIMIT || 1000;  // calls per day (UTC), all users together: bounds the bill
const PER_MIN = +env.LLM_PER_MIN || 60;            // calls per minute per IP (a seminar room may share one NAT IP)
const MAX_TOKENS = +env.LLM_MAX_TOKENS || 16000;
const MAX_BODY = 256 * 1024;                       // input tokens cost money too: the app's prompts are far smaller
// fields the app sends; everything else (tools, web search, …) is dropped so the server's key can only do what the app does
const FIELDS = {
  deepseek: ['model', 'messages', 'max_tokens', 'thinking'],
  anthropic: ['model', 'messages', 'system', 'max_tokens', 'output_config', 'fallbacks'],
};
const BETAS = ['server-side-fallback-2026-07-01'];

const hash = s => crypto.createHash('sha256').update(String(s || '')).digest();
const codeOk = c => !CODE || crypto.timingSafeEqual(hash(c), hash(CODE));

let day = '', used = 0;
const perIp = new Map(), badCode = new Map(); // ip -> [window start, count]
const over = (map, ip, ms, max) => {
  const now = Date.now(), w = map.get(ip);
  if (!w || now - w[0] > ms) { map.set(ip, [now, 1]); return false; }
  return ++w[1] > max;
};
function spend(ip) {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) { day = today; used = 0; perIp.clear(); badCode.clear(); }
  if (used >= DAILY_LIMIT) return 'The shared LLM budget for today is used up. Add your own API key under “API key”.';
  if (over(perIp, ip, 60000, PER_MIN)) return 'Too many LLM calls from this network; wait a minute.';
  used++;
  return null;
}
// behind Cloudflare the client IP is in cf-connecting-ip; Caddy sets x-forwarded-for
const clientIp = req => req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;

const readBody = req => new Promise((ok, fail) => {
  const chunks = []; let n = 0;
  req.on('data', c => { n += c.length; if (n > MAX_BODY) { fail(new Error('too large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => ok(Buffer.concat(chunks).toString()));
  req.on('error', fail);
});

export const llmInfo = () => ({
  providers: Object.fromEntries(Object.entries(PROVIDERS).map(([k, p]) => [k, !!p.key])),
  models: MODELS, code: !!CODE, left: Math.max(0, DAILY_LIMIT - (day === new Date().toISOString().slice(0, 10) ? used : 0)),
});

export async function llmRoute(req, res, provider, origins) {
  const origin = req.headers.origin, allowed = origins.includes(origin);
  const cors = allowed ? { 'access-control-allow-origin': origin, vary: 'origin' } : {};
  const reply = (status, body) => { res.writeHead(status, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify(body)); };
  const fail = (status, message) => reply(status, { error: { message } }); // same shape as the providers' errors

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...cors, 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type, x-access-code, anthropic-beta', 'access-control-max-age': '600' });
    return res.end();
  }
  if (req.method === 'GET' && !provider) return reply(200, llmInfo());
  const p = PROVIDERS[provider];
  if (req.method !== 'POST' || !p) return fail(404, 'not found');
  if (!allowed) return fail(403, 'origin not allowed');
  if (!p.key) return fail(503, `The server has no ${provider} key. Add your own API key under “API key”.`);
  const ip = clientIp(req);
  if (badCode.get(ip)?.[1] >= 10 && Date.now() - badCode.get(ip)[0] < 600000) return fail(429, 'Too many wrong access codes; wait 10 minutes.');
  if (!codeOk(req.headers['x-access-code'])) {
    over(badCode, ip, 600000, 10); // ponytail: 10 guesses per IP per 10 min; the code should still be long and random
    return fail(401, 'Wrong or missing access code. Enter the code from the organizer under “API key”.');
  }

  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return fail(400, 'bad request body'); }
  if (!body || !MODELS.includes(body.model)) return fail(400, `Model not offered by the server. Allowed: ${MODELS.join(', ')}.`);
  const spent = spend(ip);
  if (spent) return fail(429, spent);
  body = Object.fromEntries(FIELDS[provider].filter(k => k in body).map(k => [k, body[k]]));
  body.max_tokens = Math.min(+body.max_tokens || MAX_TOKENS, MAX_TOKENS);

  const beta = provider === 'anthropic' && BETAS.includes(req.headers['anthropic-beta']) && req.headers['anthropic-beta'];
  try {
    const r = await fetch(p.url, {
      method: 'POST', signal: AbortSignal.timeout(180000), body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...p.auth(p.key), ...(beta && { 'anthropic-beta': beta }) },
    });
    // the provider's auth errors quote part of the key: never pass those on
    if (r.status === 401 || r.status === 403) return fail(502, 'The server’s LLM key was rejected by the provider. Tell the organizer, or add your own key under “API key”.');
    res.writeHead(r.status, { 'content-type': 'application/json', ...cors });
    res.end(await r.text());
  } catch (e) {
    fail(502, `LLM provider unreachable: ${e.message}`);
  }
}
