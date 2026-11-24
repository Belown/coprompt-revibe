// Where the sync backend lives. The only place to change it.
//   ?server=wss://host  overrides it for one session
//   ?local=1            skips the backend: same-browser sync over BroadcastChannel (also the fallback when it is unreachable)
//   ?room=name          picks a notebook; one room per group or demo
const q = new URLSearchParams(location.search);
const isLocalhost = ['localhost', '127.0.0.1'].includes(location.hostname);

// deployed: same origin, under /api (Caddy proxies it to the backend); local dev: the backend on :8787
export const SERVER = q.get('server') || (isLocalhost ? `ws://${location.hostname}:8787` : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api`);
export const LOCAL = q.get('local') === '1';
export const ROOM = q.get('room') || 'default';
// the same backend over HTTP, for the LLM proxy (/llm)
export const API = SERVER.replace(/^ws/, 'http');
