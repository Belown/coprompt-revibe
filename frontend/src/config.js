// Where the sync backend lives. The only place to change it.
//   ?server=wss://host  overrides it for one session
//   ?local=1            skips the backend: same-browser sync over BroadcastChannel (also the fallback when it is unreachable)
//   ?room=name          picks a notebook; one room per group or demo
const q = new URLSearchParams(location.search);
const isLocalhost = ['localhost', '127.0.0.1'].includes(location.hostname);

export const SERVER = q.get('server') || (isLocalhost ? `ws://${location.hostname}:8787` : 'wss://api.coprompt-revibe.wangleishen.com');
export const LOCAL = q.get('local') === '1';
export const ROOM = q.get('room') || 'default';
