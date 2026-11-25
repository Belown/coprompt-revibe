// LLM client: DeepSeek by default; a model name starting with "claude" uses Anthropic.
// With your own key (Settings), calls go straight from the browser to the provider. Without one, they go through the
// backend's proxy (backend/llm.js) when the server has a key for that provider.
import { outline } from './model.js';
import { openModal } from './ui.js';
import { emit } from './bus.js';
import { API, DEMO } from '../config.js';
import { scripted } from './demo.js';
import { S } from './store.js';
import { scenario } from './scenarios.js';

export const MODEL = () => localStorage.getItem('cp_model') || 'deepseek-flash';
const PROVIDER = () => MODEL().startsWith('claude') ? 'anthropic' : 'deepseek';
const ownKey = () => localStorage.getItem('cp_key');
let server = null; // what the proxy offers: {providers, models, code, left}; null = no proxy reachable
fetch(API + '/llm').then(r => r.ok && r.json()).then(d => { server = d || null; emit(); }).catch(() => {});
const viaServer = () => !ownKey() && !!server?.providers[PROVIDER()];
export const hasKey = () => DEMO || !!window.__llmStub || !!ownKey() || viaServer(); // the e2e stub and the demo script count as a model
window.addEventListener('storage', e => { if (e.key === 'cp_key') emit(); });

// direct: the provider's URL with your key; proxied: the backend with the access code (if the server wants one)
function endpoint(direct, headers) {
  return viaServer()
    ? [`${API}/llm/${PROVIDER()}`, { 'x-access-code': localStorage.getItem('cp_code') || '' }]
    : [direct, headers(ownKey())];
}

// no key: the API key dialog opens and says why, so the error is quiet (toastErr skips it; inline views still show it)
export function needKey() { openSettings(true); return Object.assign(new Error('Add an API key to use the model.'), { quiet: true }); }
// a failed call in the user's terms; the provider's own text only as a detail
const post = (url, init) => fetch(url, init).catch(() => { throw new Error('Could not reach the model service. Check your connection and try again.'); });
async function failed(r) {
  const d = await r.json().catch(() => ({})), s = r.status;
  const why = s === 401 || s === 403 ? 'The API key (or access code) was rejected. Check it under API key.'
    : s === 429 ? 'Too many requests, or today’s limit is used up. Try again later.'
    : s >= 500 ? 'The model service had a problem. Try again in a moment.'
    : `The model call failed${d.error?.message ? `: ${d.error.message}` : '.'}`;
  return new Error(`${why} (${s})`);
}

export async function llm(user, json) {
  if (window.__llmStub) return window.__llmStub(user, json); // e2e.mjs replaces the model with a stub
  if (DEMO) return scripted(user); // the offline demo: scripted answers (lib/demo.js)
  if (!hasKey()) throw needKey();
  const system = `You are the code-generation engine of CoPrompt, a collaborative natural-language programming notebook.
Environment: Python 3 in the browser (Pyodide) with pandas, numpy, matplotlib, scipy and scikit-learn (seaborn may be available). ${scenario(S?.scenario).data}
Before a block runs, all code blocks above it run top to bottom in the same namespace, so their variables can be used directly.
Never use Markdown code fences. ${json ? 'Reply with JSON only.' : 'Reply with raw Python code only.'}
Notebook outline (the prompt wiki; [Name] = who does it):
${outline()}`;
  let t;
  if (!MODEL().startsWith('claude')) { // DeepSeek, OpenAI-compatible chat completions
    const [url, auth] = endpoint('https://api.deepseek.com/chat/completions', key => ({ authorization: `Bearer ${key}` }));
    const r = await post(url, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL(), max_tokens: 8000, thinking: { type: 'disabled' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
    if (!r.ok) throw await failed(r);
    t = (await r.json()).choices[0].message.content;
  } else t = await claude(system, user);
  if (!json) return t.replace(/^\s*```[\w-]*\s*$/gm, '').trim();
  const m = t.match(/[[{][\s\S]*[\]}]/);
  if (!m) throw new Error('Model did not return JSON');
  return JSON.parse(m[0]);
}
async function claude(system, user) {
  const [url, auth] = endpoint('https://api.anthropic.com/v1/messages',
    key => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }));
  const call = fb => post(url, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json', ...(fb && { 'anthropic-beta': 'server-side-fallback-2026-07-01' }) },
    body: JSON.stringify({ model: MODEL(), max_tokens: 16000, system, output_config: { effort: 'low' },
      ...(fb && { fallbacks: 'default' }), messages: [{ role: 'user', content: user }] }),
  });
  let r = await call(true);
  if (r.status === 400) r = await call(false); // account/model without the fallback beta
  if (!r.ok) throw await failed(r);
  const d = await r.json();
  if (d.stop_reason === 'refusal') throw new Error('The model declined this request.');
  return d.content.filter(c => c.type === 'text').map(c => c.text).join('');
}

export async function openSettings(needed = false) { // needed: opened because something needed the model
  const offered = server && Object.entries(server.providers).filter(([, on]) => on).map(([p]) => p);
  const r = await openModal({ title: 'API key', ok: 'Save',
    body: needed ? ['Generating code, Explain, and refer, request and link all call a language model. Add a key to use them, then try again.'] : [],
    fields: [
    { key: 'key', label: offered?.length ? 'Your own API key (optional)' : 'API key (DeepSeek, or Anthropic for claude-* models)',
      type: 'password', placeholder: 'sk-…', value: ownKey() || '' },
    ...(server?.code && offered?.length ? [{ key: 'code', label: 'Access code (from the organizer)', type: 'password', value: localStorage.getItem('cp_code') || '' }] : []),
    { key: 'model', label: 'Model (deepseek-flash, deepseek-v4-pro, or e.g. claude-opus-5-5)', value: MODEL() }],
    note: offered?.length
      ? `This server provides a ${offered.join(' and ')} key for ${server.models.join(', ')} (${server.left} calls left today), so you can leave the key empty. With your own key, requests go straight to the provider and do not use the shared budget.`
      : 'Stored in this browser’s localStorage (shared by all CoPrompt windows); requests go straight to the provider’s API.' });
  if (!r) return;
  localStorage.setItem('cp_key', r.key.trim()); localStorage.setItem('cp_model', r.model.trim() || 'deepseek-flash');
  if (r.code !== undefined) localStorage.setItem('cp_code', r.code.trim());
  emit();
}
