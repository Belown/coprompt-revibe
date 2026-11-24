// CoPrompt sync server: one WebSocket relay per room, replacing the BroadcastChannel between windows.
// The room state is {epoch, S}; S = {blocks: {}, actions: {}}, the same object the frontend keeps.
// ponytail: whole-object last-writer-wins, no CRDT. Concurrent typing in one prompt is still not merged.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';

const env = process.env;
const PORT = +env.PORT || 8787;
const DATA_DIR = path.resolve(env.DATA_DIR || './data');
const ORIGINS = (env.ALLOWED_ORIGINS || 'https://app.coprompt-revibe.wangleishen.com,http://localhost:8000').split(',').map(s => s.trim());
const MAX_MSG_BYTES = +env.MAX_MSG_BYTES || 2 * 1024 * 1024; // a block carries its outputs (plots) and history
const MAX_CONN_PER_ROOM = +env.MAX_CONN_PER_ROOM || 20;
const MAX_ROOMS = +env.MAX_ROOMS || 100;                    // rooms on disk; caps what an anonymous client can create
const MSG_RATE = +env.MSG_RATE || 20;                         // messages per second per connection, sustained
const MSG_BURST = +env.MSG_BURST || 200;                      // a reconnect replays every locally newer object at once
const HEARTBEAT_MS = +env.HEARTBEAT_MS || 30000;
const SAVE_DELAY_MS = 1000;

const NAME = /^[\w-]{1,64}$/;           // room names and object ids (uid() is base36)
const KINDS = ['blocks', 'actions'];
const validState = S => S && typeof S === 'object' && KINDS.every(k => S[k] && typeof S[k] === 'object' && !Array.isArray(S[k]));

fs.mkdirSync(DATA_DIR, { recursive: true });
const rooms = new Map(); // name -> {name, file, epoch, S, clients: Set<ws>, timer}

function openRoom(name) {
  let r = rooms.get(name);
  if (r) return r;
  const file = path.join(DATA_DIR, name + '.json');
  const saved = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  if (!saved && fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json')).length >= MAX_ROOMS) return null;
  r = { name, file, epoch: saved?.epoch || 0, S: saved?.S || null, clients: new Set(), timer: null };
  rooms.set(name, r);
  return r;
}
function flush(r) {
  clearTimeout(r.timer); r.timer = null;
  if (!r.S) return;
  fs.writeFileSync(r.file + '.tmp', JSON.stringify({ epoch: r.epoch, S: r.S }));
  fs.renameSync(r.file + '.tmp', r.file); // atomic: a crash mid-write never leaves half a room
}
const changed = r => { r.timer ||= setTimeout(() => flush(r), SAVE_DELAY_MS); };

const send = (ws, m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
const others = (ws, m) => { const s = JSON.stringify(m); for (const c of ws.room.clients) if (c !== ws && c.readyState === 1) c.send(s); };
const all = (r, m) => { const s = JSON.stringify(m); for (const c of r.clients) if (c.readyState === 1) c.send(s); };

function onMessage(ws, m) {
  const r = ws.room;
  switch (m.t) {
    case 'hello': { // the first client into an empty room supplies the seed; everyone else gets the room as it is
      if (!r.S) { if (!validState(m.seed)) return ws.close(1007, 'bad seed'); r.S = m.seed; changed(r); }
      send(ws, { t: 'snapshot', S: r.S, epoch: r.epoch });
      for (const c of r.clients) if (c !== ws) { // replay what the others are doing right now
        if (c.b) send(ws, { t: 'presence', user: c.user, b: c.b });
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
      r.S[kind][obj.id] = obj; changed(r);
      return others(ws, { t: 'put', kind, obj });
    }
    case 'presence':
      ws.b = typeof m.b === 'string' ? m.b : null;
      return others(ws, { t: 'presence', user: ws.user, b: ws.b });
    case 'busy': {
      if (typeof m.id !== 'string') return;
      const label = typeof m.label === 'string' ? m.label : null;
      label ? ws.busy[m.id] = label : delete ws.busy[m.id];
      return others(ws, { t: 'busy', id: m.id, label, user: ws.user });
    }
    case 'reset':
      if (!validState(m.S)) return ws.close(1007, 'bad reset');
      r.S = m.S; r.epoch++; changed(r);
      return all(r, { t: 'reset', S: r.S, epoch: r.epoch }); // the sender too, so it learns the new epoch
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
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
      if (!isBinary && m && typeof m === 'object') onMessage(ws, m);
    });
    ws.on('close', () => {
      room.clients.delete(ws);
      if (ws.b) others(ws, { t: 'presence', user: ws.user, b: null }); // no ghost "✎ Bob" after a dropped connection
      for (const id of Object.keys(ws.busy)) others(ws, { t: 'busy', id, label: null, user: ws.user });
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
