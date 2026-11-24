// LLM client: DeepSeek by default; a model name starting with "claude" uses Anthropic.
// With your own key (Settings), calls go straight from the browser to the provider. Without one, they go through the
// backend's proxy (backend/llm.js) when the server has a key for that provider.
import { outline } from './model.js';
import { openModal } from './ui.js';
import { emit } from './bus.js';
import { API } from '../config.js';

export const MODEL = () => localStorage.getItem('cp_model') || 'deepseek-flash';
const PROVIDER = () => MODEL().startsWith('claude') ? 'anthropic' : 'deepseek';
const ownKey = () => localStorage.getItem('cp_key');
let server = null; // what the proxy offers: {providers, models, code, left}; null = no proxy reachable
fetch(API + '/llm').then(r => r.ok && r.json()).then(d => { server = d || null; emit(); }).catch(() => {});
const viaServer = () => !ownKey() && !!server?.providers[PROVIDER()];
export const hasKey = () => !!ownKey() || viaServer();
window.addEventListener('storage', e => { if (e.key === 'cp_key') emit(); });

// direct: the provider's URL with your key; proxied: the backend with the access code (if the server wants one)
function endpoint(direct, headers) {
  return viaServer()
    ? [`${API}/llm/${PROVIDER()}`, { 'x-access-code': localStorage.getItem('cp_code') || '' }]
    : [direct, headers(ownKey())];
}

export async function llm(user, json) {
  if (window.__llmStub) return window.__llmStub(user, json); // e2e.mjs replaces the model with a stub
  if (!hasKey()) { openSettings(); throw new Error('Set an API key first (⚙).'); }
  const system = `You are the code-generation engine of CoPrompt, a collaborative natural-language programming notebook.
Environment: Python 3 in the browser (Pyodide) with pandas, numpy, matplotlib, scipy and scikit-learn (seaborn may be available). The dataset is the Kaggle Titanic training set at 'data/titanic.csv'.
Before a block runs, all code blocks above it run top to bottom in the same namespace, so their variables can be used directly.
Never use Markdown code fences. ${json ? 'Reply with JSON only.' : 'Reply with raw Python code only.'}
Notebook outline (the prompt wiki; [Name] = author):
${outline()}`;
  let t;
  if (!MODEL().startsWith('claude')) { // DeepSeek, OpenAI-compatible chat completions
    const [url, auth] = endpoint('https://api.deepseek.com/chat/completions', key => ({ authorization: `Bearer ${key}` }));
    const r = await fetch(url, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL(), max_tokens: 8000, thinking: { type: 'disabled' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(`LLM error: ${d.error?.message || r.status}`);
    t = d.choices[0].message.content;
  } else t = await claude(system, user);
  if (!json) return t.replace(/^\s*```[\w-]*\s*$/gm, '').trim();
  const m = t.match(/[[{][\s\S]*[\]}]/);
  if (!m) throw new Error('Model did not return JSON');
  return JSON.parse(m[0]);
}
async function claude(system, user) {
  const [url, auth] = endpoint('https://api.anthropic.com/v1/messages',
    key => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }));
  const call = fb => fetch(url, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json', ...(fb && { 'anthropic-beta': 'server-side-fallback-2026-07-01' }) },
    body: JSON.stringify({ model: MODEL(), max_tokens: 16000, system, output_config: { effort: 'low' },
      ...(fb && { fallbacks: 'default' }), messages: [{ role: 'user', content: user }] }),
  });
  let r = await call(true);
  if (r.status === 400) r = await call(false); // account/model without the fallback beta
  const d = await r.json();
  if (!r.ok) throw new Error(`LLM error: ${d.error?.message || r.status}`);
  if (d.stop_reason === 'refusal') throw new Error('The model declined this request.');
  return d.content.filter(c => c.type === 'text').map(c => c.text).join('');
}

export async function openSettings() {
  const offered = server && Object.entries(server.providers).filter(([, on]) => on).map(([p]) => p);
  const r = await openModal({ title: 'Settings', ok: 'Save', fields: [
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
