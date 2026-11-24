// Transports for the shared notebook. Both speak the same messages (see backend/server.js):
//   send: hello{seed} put{kind,obj,epoch} y{u,aw,id} presence{b} cursor{c} busy{id,label} reset{S}
//   receive: snapshot{S,epoch,y} put{kind,obj} y{u|aw|gone} presence{user,b} cursor{user,c} busy{id,label,user} reset{S,epoch}
// y carries prompt text as Y.js updates (u) and text cursors as awareness updates (aw), both base64.
// connect(onMsg, onStatus) returns {send}; onStatus gets 'connected' | 'reconnecting' | 'local'.
import { SERVER, ROOM } from '../config.js';
import { ME } from './util.js';
import { toast } from './ui.js';
import * as Y from 'yjs';
import { initTexts, b64, unb64 } from './ytext.js';

// Same-browser windows: BroadcastChannel relays, localStorage plays the server (holds the room, decides the seed).
export function local(onMsg, onStatus) {
  const key = 'coprompt-state:' + ROOM, bc = new BroadcastChannel(key);
  const load = () => JSON.parse(localStorage.getItem(key) || 'null');
  const store = st => {
    try { localStorage.setItem(key, JSON.stringify(st)); }
    catch { toast('Browser storage is full: changes still sync live but will not survive a reload. Use Reset demo.'); }
  };
  // prompt text: the merged Y.js state, kept like the room; a new notebook's starting text is written once, here
  const ykey = 'coprompt-y:' + ROOM, yload = () => localStorage.getItem(ykey);
  const ysave = u => { try { localStorage.setItem(ykey, b64(u)); } catch { /* storage full: the toast above already said so */ } };
  const yinit = st => {
    const d = new Y.Doc(), cur = yload(); if (cur) Y.applyUpdate(d, unb64(cur));
    const sv = Y.encodeStateVector(d); initTexts(d, st); ysave(Y.encodeStateAsUpdate(d));
    return { t: 'y', u: b64(Y.encodeStateAsUpdate(d, sv)) }; // just what the init added
  };
  bc.onmessage = e => onMsg(e.data);
  setTimeout(() => onStatus('local'));
  return {
    send(m) {
      if (m.t === 'hello') { let st = load(); if (!st) store(st = m.seed); bc.postMessage(yinit(st)); return onMsg({ t: 'snapshot', S: st, y: yload() }); }
      if (m.t === 'y' && m.u) { const cur = yload(); ysave(cur ? Y.mergeUpdates([unb64(cur), unb64(m.u)]) : unb64(m.u)); }
      if (m.t === 'put') { const st = load(); if (st && !(st[m.kind][m.obj.id]?.upd > m.obj.upd)) { st[m.kind][m.obj.id] = m.obj; store(st); } }
      if (m.t === 'reset') { store(m.S); bc.postMessage(m); const y = yinit(m.S); bc.postMessage(y); return onMsg(y); }
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
