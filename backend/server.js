// CoPrompt sync server: one WebSocket relay per room, replacing the BroadcastChannel between windows.
// The room state is {epoch, S, y}; S = {blocks: {}, actions: {}}, the same object the frontend keeps, synced
// per object, last writer wins. y is the room's Y.js document: the text of every prompt (a CRDT, so concurrent
// typing in one prompt merges, §6.3), one XmlFragment 'p:<block id>' each.
import http from 'node:http';
import * as Y from 'yjs';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { llmRoute } from './llm.js';

const env = process.env;
const PORT = +env.PORT || 8787;
const DATA_DIR = path.resolve(env.DATA_DIR || './data');
const ORIGINS = (env.ALLOWED_ORIGINS || 'https://coprompt-revibe.wangleishen.com,http://localhost:8000').split(',').map(s => s.trim());
const MAX_MSG_BYTES = +env.MAX_MSG_BYTES || 2 * 1024 * 1024; // a block carries its outputs (plots) and history
const MAX_CONN_PER_ROOM = +env.MAX_CONN_PER_ROOM || 20;
const MAX_ROOMS = +env.MAX_ROOMS || 100;                    // rooms on disk; caps what an anonymous client can create
const MAX_ROOM_BYTES = +env.MAX_ROOM_BYTES || 20 * 1024 * 1024; // one room's JSON; bounds RAM and disk (MAX_ROOMS × this)
const MSG_RATE = +env.MSG_RATE || 30;                         // messages per second per connection, sustained
const MSG_BURST = +env.MSG_BURST || 200;                      // a reconnect replays every locally newer object at once
const HEARTBEAT_MS = +env.HEARTBEAT_MS || 30000;
const SAVE_DELAY_MS = 1000;

const NAME = /^[\w-]{1,64}$/;           // room names and object ids (uid() is base36)
const ANCHOR = /^(id|b|w):[\w-]{1,64}$/; // a live pointer's anchor: an element id, a block, a wiki row
const KINDS = ['blocks', 'actions'];
const validState = S => S && typeof S === 'object' && KINDS.every(k => S[k] && typeof S[k] === 'object' && !Array.isArray(S[k]));

fs.mkdirSync(DATA_DIR, { recursive: true });
const rooms = new Map(); // name -> {name, file, epoch, S, ydoc, bytes, clients: Set<ws>, timer}
const b64 = u => Buffer.from(u).toString('base64');

// The Y.js shape y-tiptap gives a TipTap paragraph: text is an XmlText, a node chip an XmlElement 'promptNode'.
// Same function as paragraph() in frontend/src/lib/ytext.js.
function paragraph(segs) {
  const p = new Y.XmlElement('paragraph');
  p.insert(0, segs.filter(s => typeof s?.v === 'string' && (s.t === 'node' || s.v)).map(s => {
    if (s.t === 'node') { const n = new Y.XmlElement('promptNode'); n.setAttribute('id', String(s.id)); n.setAttribute('v', s.v); return n; }
    const t = new Y.XmlText(); t.insert(0, s.v); return t;
  }));
  return p;
}
// A prompt block's starting text (the seed's, or a room saved before prompts were Y.js) goes into its fragment once,
// here on the server, so two clients can never both write it (which would duplicate it).
function initTexts(r) {
  const done = r.ydoc.getMap('init');
  r.ydoc.transact(() => {
    for (const b of Object.values(r.S.blocks)) if (b?.kind === 'p' && typeof b.id === 'string' && !done.has(b.id)) {
      done.set(b.id, true);
      if (Array.isArray(b.segs) && b.segs.length) r.ydoc.getXmlFragment('p:' + b.id).insert(0, [paragraph(b.segs)]);
    }
  }, 'server');
}

function openRoom(name) {
  let r = rooms.get(name);
  if (r) return r;
  const file = path.join(DATA_DIR, name + '.json');
  const saved = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  if (!saved && (rooms.size >= MAX_ROOMS || fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json')).length >= MAX_ROOMS)) return null;
  r = { name, file, epoch: saved?.epoch || 0, S: saved?.S || null, ydoc: new Y.Doc(), bytes: saved ? fs.statSync(file).size : 0, clients: new Set(), timer: null };
  if (saved?.y) Y.applyUpdate(r.ydoc, Buffer.from(saved.y, 'base64'));
  // every change reaches the other clients: a client's update (origin = its socket) and the server's own init
  r.ydoc.on('update', (u, origin) => {
    const s = JSON.stringify({ t: 'y', u: b64(u) });
    for (const c of r.clients) if (c !== origin && c.readyState === 1) c.send(s);
    if (r.S) changed(r);
  });
  if (r.S) initTexts(r); // a room saved before prompts were Y.js
  rooms.set(name, r);
  return r;
}
function flush(r) {
  clearTimeout(r.timer); r.timer = null;
  if (!r.S) return;
  const json = JSON.stringify({ epoch: r.epoch, S: r.S, y: b64(Y.encodeStateAsUpdate(r.ydoc)) });
  r.bytes = json.length; // exact again; between flushes puts are added on top (an overestimate, so the cap errs safe)
  fs.writeFileSync(r.file + '.tmp', json);
  fs.renameSync(r.file + '.tmp', r.file); // atomic: a crash mid-write never leaves half a room
}
const changed = r => { r.timer ||= setTimeout(() => flush(r), SAVE_DELAY_MS); };

const send = (ws, m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
const others = (ws, m) => { const s = JSON.stringify(m); for (const c of ws.room.clients) if (c !== ws && c.readyState === 1) c.send(s); };
const all = (r, m) => { const s = JSON.stringify(m); for (const c of r.clients) if (c.readyState === 1) c.send(s); };

function onMessage(ws, m, size) {
  const r = ws.room;
  switch (m.t) {
    case 'hello': { // the first client into an empty room supplies the seed; everyone else gets the room as it is
      if (!r.S) { if (!validState(m.seed)) return ws.close(1007, 'bad seed'); r.S = m.seed; r.bytes = size; initTexts(r); changed(r); }
      send(ws, { t: 'snapshot', S: r.S, epoch: r.epoch, y: b64(Y.encodeStateAsUpdate(r.ydoc)) });
      for (const c of r.clients) if (c !== ws) { // replay what the others are doing right now
        if (c.b) send(ws, { t: 'presence', user: c.user, b: c.b });
        if (c.aw) send(ws, { t: 'y', aw: c.aw }); // their text cursor (Y.js awareness)
        for (const [id, label] of Object.entries(c.busy)) send(ws, { t: 'busy', id, label, user: c.user });
      }
      return;
    }
    case 'put': {
      const { kind, obj } = m;
      if (!r.S || m.epoch !== r.epoch) return; // before hello, or written against a notebook that was reset since
      if (!KINDS.includes(kind) || !obj || typeof obj !== 'object' || !NAME.test(obj.id) || obj.id === '__proto__' || !Number.isFinite(obj.upd))
        return ws.close(1007, 'bad put');
      const cur = r.S[kind][obj.id];
      if (cur && !(obj.upd > cur.upd)) return send(ws, { t: 'put', kind, obj: cur }); // lost: tell the writer what won
      if (r.bytes + size > MAX_ROOM_BYTES) return ws.close(1009, 'room full'); // stops anyone filling RAM and disk
      r.S[kind][obj.id] = obj; r.bytes += size; changed(r);
      return others(ws, { t: 'put', kind, obj });
    }
    case 'presence':
      ws.b = typeof m.b === 'string' && NAME.test(m.b) ? m.b : null; // a block id
      return others(ws, { t: 'presence', user: ws.user, b: ws.b });
    case 'y': { // prompt text (a Y.js update, merged here and relayed by the ydoc's update handler) and/or awareness
      if (!r.S) return;
      if (typeof m.u === 'string') {
        if (r.bytes + size > MAX_ROOM_BYTES) return ws.close(1009, 'room full');
        try { Y.applyUpdate(r.ydoc, Buffer.from(m.u, 'base64'), ws); } catch { return ws.close(1007, 'bad update'); }
        r.bytes += size;
      }
      if (typeof m.aw === 'string' && m.aw.length <= 4096) { // text cursor and selection: relayed, the latest kept for late joiners
        ws.aw = m.aw; if (Number.isSafeInteger(m.id)) ws.yid = m.id;
        others(ws, { t: 'y', aw: m.aw });
      }
      return;
    }
    case 'cursor': { // a live mouse pointer: an anchor element, the position in it as fractions, a click count; not stored
      const c = m.c, ok = c && typeof c === 'object' && typeof c.a === 'string' && ANCHOR.test(c.a)
        && [c.x, c.y].every(v => Number.isFinite(v) && v >= 0 && v <= 1) && (c.k == null || (Number.isSafeInteger(c.k) && c.k >= 0));
      ws.cur = true;
      return others(ws, { t: 'cursor', user: ws.user, c: ok ? { a: c.a, x: c.x, y: c.y, k: c.k || 0 } : null });
    }
    case 'busy': {
      if (typeof m.id !== 'string' || !NAME.test(m.id)) return;
      const label = typeof m.label === 'string' ? m.label.slice(0, 100) : null;
      if (label && !ws.busy[m.id] && Object.keys(ws.busy).length >= 50) return;
      label ? ws.busy[m.id] = label : delete ws.busy[m.id];
      return others(ws, { t: 'busy', id: m.id, label, user: ws.user });
    }
    case 'reset':
      if (!validState(m.S)) return ws.close(1007, 'bad reset');
      r.S = m.S; r.bytes = size; r.epoch++; changed(r);
      all(r, { t: 'reset', S: r.S, epoch: r.epoch }); // the sender too, so it learns the new epoch
      return initTexts(r); // the new blocks' text follows as a Y.js update (old fragments stay, unreferenced)
  }
}

const server = http.createServer((req, res) => {
  const route = new URL(req.url, 'http://x').pathname;
  if (route === '/llm' || route.startsWith('/llm/')) return llmRoute(req, res, route.slice(5) || null, ORIGINS);
  if (req.method === 'GET' && route === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, rooms: rooms.size, clients: wss.clients.size }));
  }
  res.writeHead(404).end();
});
const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MSG_BYTES });
const refuse = (sock, code, text) => { sock.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`); };

server.on('upgrade', (req, sock, head) => {
  const q = new URL(req.url, 'http://x').searchParams, name = q.get('room') || 'default';
  if (!ORIGINS.includes(req.headers.origin)) return refuse(sock, 403, 'Forbidden');
  if (!NAME.test(name)) return refuse(sock, 400, 'Bad Request');
  if (rooms.get(name)?.clients.size >= MAX_CONN_PER_ROOM) return refuse(sock, 503, 'Room Full');
  const room = openRoom(name);
  if (!room) return refuse(sock, 503, 'Too Many Rooms');
  wss.handleUpgrade(req, sock, head, ws => {
    Object.assign(ws, { room, user: (q.get('user') || 'anon').slice(0, 40), b: null, busy: {}, alive: true, tokens: MSG_BURST, last: Date.now() });
    room.clients.add(ws);
    ws.on('pong', () => { ws.alive = true; });
    ws.on('message', (data, isBinary) => {
      const now = Date.now(); // token bucket
      ws.tokens = Math.min(MSG_BURST, ws.tokens + (now - ws.last) * MSG_RATE / 1000); ws.last = now;
      if (--ws.tokens < 0) return ws.close(1008, 'rate limit'); // the client reconnects and resyncs
      let m; try { m = JSON.parse(data); } catch { return ws.close(1007, 'bad json'); }
      if (!isBinary && m && typeof m === 'object') onMessage(ws, m, data.length);
    });
    ws.on('close', () => {
      room.clients.delete(ws);
      if (ws.b) others(ws, { t: 'presence', user: ws.user, b: null }); // no ghost "✎ Bob" after a dropped connection
      for (const id of Object.keys(ws.busy)) others(ws, { t: 'busy', id, label: null, user: ws.user });
      if (ws.cur) others(ws, { t: 'cursor', user: ws.user, c: null });
      if (ws.yid != null) others(ws, { t: 'y', gone: ws.yid }); // drop their text cursor now, not after the awareness timeout
      if (!room.clients.size) { flush(room); rooms.delete(room.name); }
    });
  });
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; ws.ping(); }
}, HEARTBEAT_MS);

function shutdown(sig) {
  console.log(`${sig}: saving ${rooms.size} room(s) and exiting`);
  clearInterval(heartbeat);
  for (const r of rooms.values()) flush(r);
  for (const ws of wss.clients) ws.close(1012, 'server restart'); // 1012: clients reconnect
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, () => console.log(`coprompt sync on :${PORT}, data in ${DATA_DIR}, origins ${ORIGINS.join(' ')}`));
