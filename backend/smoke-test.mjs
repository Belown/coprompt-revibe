// Starts the server on a temp dir and checks the protocol: seed race, LWW, reset epochs, origin check, persistence.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import * as Y from 'yjs';

const PORT = 18787, DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-sync-')), ORIGIN = 'http://localhost:8000';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const start = async () => {
  const p = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT, DATA_DIR, DEEPSEEK_API_KEY: 'not-a-real-key', ANTHROPIC_API_KEY: '', LLM_ACCESS_CODE: 'letmein', MAX_ROOM_BYTES: 50000 }, stdio: 'inherit' });
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

// a room saved before prompts were Y.js: its text is in the blocks' segs only
fs.writeFileSync(path.join(DATA_DIR, 'legacy.json'), JSON.stringify({ epoch: 0, S: { blocks: { p1: { id: 'p1', kind: 'p', upd: 1, segs: [{ t: 'text', v: 'old prompt' }] } }, actions: {} } }));
let srv = await start();
try {
  const h = await fetch(`http://localhost:${PORT}/health`);
  assert.equal(h.status, 200);

  await assert.rejects(client('Eve', 'https://evil.example').open, 'foreign origin is refused');
  { // legacy room: the server turns its prompts' segs into Y.js text when it opens the room
    const L = new WebSocket(`ws://localhost:${PORT}/?room=legacy&user=Lee`, { origin: ORIGIN });
    await new Promise(r => L.on('open', r)); L.send(JSON.stringify({ t: 'hello', seed: seed('l') }));
    const snap = await new Promise(r => L.on('message', d => { const m = JSON.parse(d); if (m.t === 'snapshot') r(m); }));
    const d = new Y.Doc(); Y.applyUpdate(d, Buffer.from(snap.y, 'base64'));
    assert.equal(d.getXmlFragment('p:p1').toString(), '<paragraph>old prompt</paragraph>', 'a legacy room gets its prompt text in Y.js');
    L.close();
  }

  // LLM proxy guards (nothing here reaches a provider)
  const llm = (path, { origin = ORIGIN, code, body, method = 'POST' } = {}) => fetch(`http://localhost:${PORT}/llm${path}`,
    { method, headers: { origin, 'content-type': 'application/json', ...(code && { 'x-access-code': code }) }, body: body && JSON.stringify(body) });
  const info = await (await llm('', { method: 'GET' })).json();
  assert.deepEqual(info.providers, { deepseek: true, anthropic: false }); assert.equal(info.code, true);
  assert.equal((await llm('', { method: 'OPTIONS' })).headers.get('access-control-allow-origin'), ORIGIN, 'preflight');
  const ok = { model: 'deepseek-flash', messages: [] };
  assert.equal((await llm('/deepseek', { origin: 'https://evil.example', code: 'letmein', body: ok })).status, 403);
  assert.equal((await llm('/deepseek', { body: ok })).status, 401, 'access code required');
  assert.equal((await llm('/deepseek', { code: 'nope', body: ok })).status, 401);
  assert.equal((await llm('/deepseek', { code: 'letmein', body: { ...ok, model: 'gpt-x' } })).status, 400, 'model allowlist');
  assert.equal((await llm('/anthropic', { code: 'letmein', body: ok })).status, 503, 'no server key for that provider');
  for (let i = 0; i < 8; i++) await llm('/deepseek', { code: 'guess' + i, body: ok }); // 10 wrong codes in all
  assert.equal((await llm('/deepseek', { code: 'letmein', body: ok })).status, 429, 'access code guessing is throttled');

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
  A.send({ t: 'cursor', c: { a: 'id:settings', x: 0.5, y: 0.25, k: 3 } });
  assert.deepEqual(await C.next('cursor'), { t: 'cursor', user: 'Alice', c: { a: 'id:settings', x: 0.5, y: 0.25, k: 3 } });
  A.send({ t: 'cursor', c: { a: 'q:"]<x>', x: 0.5, y: 0 } });
  assert.equal((await C.next('cursor')).c, null, 'a cursor with a bad anchor is relayed as hidden');
  A.send({ t: 'cursor', c: { a: 'b:x', x: 9, y: 0 } });
  assert.equal((await C.next('cursor')).c, null, 'an out-of-range cursor is relayed as hidden');

  // prompt text is Y.js: a seed's starting segs are put into the room's doc once, by the server
  const ytext = (y, id) => { const d = new Y.Doc(); Y.applyUpdate(d, Buffer.from(y, 'base64')); return d.getXmlFragment('p:' + id).toString(); };
  const docA = new Y.Doc(), upd = []; docA.on('update', u => upd.push(u));
  docA.getXmlFragment('p:a').insert(0, [new Y.XmlText('hello')]);
  A.send({ t: 'y', u: Buffer.from(upd[0]).toString('base64'), aw: 'AQ==', id: 7 });
  const yb = await B.next('y'); // the text update (relayed by the server's doc) and the awareness come separately
  const yb2 = await B.next('y');
  assert.equal([yb, yb2].find(m => m.u) && ytext([yb, yb2].find(m => m.u).u, 'a'), 'hello', 'a Y.js update reaches the others');
  assert.equal([yb, yb2].find(m => m.aw)?.aw, 'AQ==', 'awareness is relayed');
  const F = client('Finn'); await F.open; F.send({ t: 'hello', seed: seed('f') });
  assert.equal(ytext((await F.next('snapshot')).y, 'a'), 'hello', 'a late joiner gets the text in the snapshot');
  assert.equal((await F.next('y')).aw, 'AQ==', "and the others' current awareness");
  F.ws.close();

  A.send({ t: 'reset', S: { blocks: { r: { id: 'r', upd: 0 }, rp: { id: 'rp', kind: 'p', upd: 0, segs: [{ t: 'text', v: 'load ' }, { t: 'node', id: 'n1', v: 'df' }] } }, actions: {} } });
  const yr = await B.next('y');
  assert.equal(ytext(yr.u, 'rp'), '<paragraph>load <promptnode id="n1" v="df"></promptnode></paragraph>', "reset: the server writes the new prompts' text");
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
  assert.ok(ytext(sd.y, 'rp').includes('load '), 'prompt text survives a restart, written once');
  assert.equal(ytext(sd.y, 'rp').split('load').length, 2);
  const closed = new Promise(r => D.ws.on('close', r));
  D.send({ t: 'put', kind: 'blocks', obj: { id: 'big', upd: 1, v: 'x'.repeat(60000) }, epoch: 1 });
  assert.equal(await closed, 1009, 'a room cannot grow past MAX_ROOM_BYTES');
  D.ws.close();
  console.log('backend smoke test: all checks passed');
} finally {
  srv.kill();
}
