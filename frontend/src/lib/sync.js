// Transports for the shared notebook. Both speak the same messages (see backend/server.js):
//   send: hello{seed} put{kind,obj,epoch} presence{b} busy{id,label} reset{S}
//   receive: snapshot{S,epoch} put{kind,obj} presence{user,b} busy{id,label,user} reset{S,epoch}
// connect(onMsg, onStatus) returns {send}; onStatus gets 'connected' | 'reconnecting' | 'local'.
import { SERVER, ROOM } from '../config.js';
import { ME } from './util.js';
import { toast } from './ui.js';

// Same-browser windows: BroadcastChannel relays, localStorage plays the server (holds the room, decides the seed).
export function local(onMsg, onStatus) {
  const key = 'coprompt-state:' + ROOM, bc = new BroadcastChannel(key);
  const load = () => JSON.parse(localStorage.getItem(key) || 'null');
  const store = st => {
    try { localStorage.setItem(key, JSON.stringify(st)); }
    catch { toast('Browser storage is full: changes still sync live but will not survive a reload. Use Reset demo.'); }
  };
  bc.onmessage = e => onMsg(e.data);
  setTimeout(() => onStatus('local'));
  return {
    send(m) {
      if (m.t === 'hello') { let st = load(); if (!st) store(st = m.seed); return onMsg({ t: 'snapshot', S: st }); }
      if (m.t === 'put') { const st = load(); if (st && !(st[m.kind][m.obj.id]?.upd > m.obj.upd)) { st[m.kind][m.obj.id] = m.obj; store(st); } }
      if (m.t === 'reset') store(m.S);
      bc.postMessage(m);
    },
  };
}

// The sync backend. A first connection that fails calls onFail (→ local mode); a dropped one reconnects with backoff.
// ponytail: nothing is queued while disconnected; the store resends its newer objects after the reconnect snapshot.
export function ws(onMsg, onStatus, onFail) {
  const url = `${SERVER}/?room=${encodeURIComponent(ROOM)}&user=${encodeURIComponent(ME)}`;
  let sock, opened = false, delay = 1000;
  (function open() {
    try { sock = new WebSocket(url); } catch { return setTimeout(onFail); } // malformed ?server= (async: T is assigned first)
    const timeout = setTimeout(() => sock.readyState === WebSocket.CONNECTING && sock.close(), 5000);
    sock.onopen = () => { clearTimeout(timeout); opened = true; delay = 1000; onStatus('connected'); };
    sock.onmessage = e => onMsg(JSON.parse(e.data));
    sock.onclose = () => {
      clearTimeout(timeout);
      if (!opened) return onFail();
      onStatus('reconnecting');
      setTimeout(open, delay * (0.5 + Math.random())); // jitter, so a server restart is not hit by everyone at once
      delay = Math.min(delay * 2, 30000);
    };
  })();
  return { send: m => sock.readyState === WebSocket.OPEN && sock.send(JSON.stringify(m)) };
}
