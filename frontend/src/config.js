// Where the sync backend lives. The only place to change it.
//   ?server=wss://host  overrides it for one session (localhost only)
//   ?local=1            skips the backend: same-browser sync over BroadcastChannel (also the fallback when it is unreachable)
//   ?room=name          picks a notebook; one room per group or demo
const q = new URLSearchParams(location.search);
const isLocalhost = ['localhost', '127.0.0.1'].includes(location.hostname);

// deployed: same origin, under /api (Caddy proxies it to the backend); local dev: the backend on :8787
// ?server= only on localhost: on the public site a crafted link would send the notebook and the access code elsewhere
export const SERVER = (isLocalhost && q.get('server')) || (isLocalhost ? `ws://${location.hostname}:8787` : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api`);
// GitHub Pages (the backup copy, .github/workflows/pages.yml) has no backend: always local there
export const LOCAL = q.get('local') === '1' || location.hostname.endsWith('.github.io');
export const ROOM = q.get('room') || 'default';
export const TOPIC = q.get('topic') || 'titanic'; // the topic a NEW room starts with (lib/scenarios.js); an existing room keeps its own
// the same backend over HTTP, for the LLM proxy (/llm)
export const API = SERVER.replace(/^ws/, 'http');
