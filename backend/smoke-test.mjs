// Starts the server on a temp dir and checks the protocol: seed race, LWW, reset epochs, origin check, persistence.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

const PORT = 18787, DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-sync-')), ORIGIN = 'http://localhost:8000';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const start = async () => {
  const p = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT, DATA_DIR }, stdio: 'inherit' });
  for (let i = 0; i < 50; i++) { try { await fetch(`http://localhost:${PORT}/health`); return p; } catch { await sleep(100); } }
  throw new Error('server did not start');
};
function client(user, origin = ORIGIN) {
  const ws = new WebSocket(`ws://localhost:${PORT}/?room=t1&user=${user}`, { origin }), inbox = [];
  ws.on('message', d => inbox.push(JSON.parse(d)));
  const next = async t => { for (let i = 0; i < 50; i++) { const k = inbox.findIndex(m => m.t === t); if (k >= 0) return inbox.splice(k, 1)[0]; await sleep(20); } throw new Error(`${user}: no ${t}`); };
  return { ws, inbox, next, send: m => ws.send(JSON.stringify(m)), open: new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); }) };
}
const seed = tag => ({ blocks: { [tag]: { id: tag, upd: 0 } }, actions: {} });

let srv = await start();
try {
  const h = await fetch(`http://localhost:${PORT}/health`);
  assert.equal(h.status, 200);

  await assert.rejects(client('Eve', 'https://evil.example').open, 'foreign origin is refused');

  const A = client('Alice'), B = client('Bob');
  await Promise.all([A.open, B.open]);
  A.send({ t: 'hello', seed: seed('a') }); B.send({ t: 'hello', seed: seed('b') }); // both start at once
  const [sa, sb] = [await A.next('snapshot'), await B.next('snapshot')];
  assert.deepEqual(sa.S, sb.S, 'only one seed wins');
  assert.ok(sa.S.blocks.a && !sa.S.blocks.b);

  A.send({ t: 'put', kind: 'blocks', obj: { id: 'x', upd: 10, v: 'A' }, epoch: 0 });
  assert.equal((await B.next('put')).obj.v, 'A');
  B.send({ t: 'put', kind: 'blocks', obj: { id: 'x', upd: 5, v: 'stale' }, epoch: 0 });
  assert.equal((await B.next('put')).obj.v, 'A', 'an older write is answered with the winner');

  A.send({ t: 'presence', b: 'x' });
  const C = client('Carol'); await C.open; C.send({ t: 'hello', seed: seed('c') });
  assert.equal((await C.next('snapshot')).S.blocks.x.v, 'A');
  assert.equal((await C.next('presence')).user, 'Alice', 'late joiner sees current presence');

  A.send({ t: 'reset', S: seed('r') });
  assert.equal((await B.next('reset')).epoch, 1);
  assert.equal((await A.next('reset')).epoch, 1);
  B.send({ t: 'put', kind: 'blocks', obj: { id: 'zombie', upd: 99 }, epoch: 0 }); // written before B saw the reset
  B.send({ t: 'put', kind: 'blocks', obj: { id: '__proto__', upd: 1 }, epoch: 1 });
  await sleep(200);
  assert.equal(A.inbox.filter(m => m.t === 'put').length, 0, 'stale-epoch put is dropped');
  assert.equal(B.ws.readyState, WebSocket.CLOSED, 'a malformed put closes the connection');

  for (const c of [A, C]) c.ws.close();
  await sleep(300); // last client gone: room flushed to disk
  srv.kill(); await sleep(300);
  srv = await start();
  const D = client('Dan'); await D.open; D.send({ t: 'hello', seed: seed('d') });
  const sd = await D.next('snapshot');
  assert.equal(sd.epoch, 1); assert.ok(sd.S.blocks.r, 'state survives a restart');
  D.ws.close();
  console.log('backend smoke test: all checks passed');
} finally {
  srv.kill();
}
