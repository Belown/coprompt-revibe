// Shared notebook state, synced through a transport (lib/sync.js): the backend, or BroadcastChannel in local mode.
// ponytail: per-object last-writer-wins, no CRDT; concurrent typing in one prompt is not merged.
import * as Y from 'yjs';
import { applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import { emit } from './bus.js';
import { uid, ME, debounce, hexcol } from './util.js';
import { ydoc, awareness, b64, unb64, segs, live } from './ytext.js';
import { toast } from './ui.js';
import { local, ws } from './sync.js';
import { LOCAL, ROOM, TOPIC } from '../config.js';
import { SCENARIOS } from './scenarios.js';

export let S = null;   // set by the first snapshot; main.jsx waits for `ready` before rendering
let epoch;             // the room's reset counter (backend only); puts from an older epoch are dropped by the server
let T;                 // transport
let resolveReady;
export const ready = new Promise(r => { resolveReady = r; });

// local (per-window) UI state that library code also needs
export const ui = {
  SOURCE: null,   // source node {b, n}; n null = whole prompt or whole section
  TGTNODE: null,  // target node clicked in the wiki
  BUSY: {}, PRES: {}, FOLD: new Set(),
  py: { text: 'Python: loading…', s: 'load' },
  conn: 'connecting', // connected | reconnecting | local
  focus: null,    // {id, part} to focus once the block is mounted
  cursors: localStorage.getItem('cp_cursors') === '1', // live cursors: off until this user turns them on
};
export const setUI = patch => { Object.assign(ui, patch); emit(); };

// What this user has already seen of each block (last version timestamp). Changes made by others, or made
// automatically by a mechanism while this user was away, stay highlighted until the user clicks the block (§5).
const SEEN_KEY = `cp_seen_${ROOM}_${ME}`;
export const lastTs = b => b.hist?.at(-1)?.ts || 0;
let SEEN = JSON.parse(localStorage.getItem(SEEN_KEY) || 'null');
const saveSeen = () => localStorage.setItem(SEEN_KEY, JSON.stringify(SEEN));
function initSeen() { SEEN = {}; for (const b of Object.values(S.blocks)) SEEN[b.id] = lastTs(b); saveSeen(); }
export function seenNow(b) { SEEN[b.id] = lastTs(b); saveSeen(); }
export const unseen = b => b.kind === 'p' && !b.del && lastTs(b) > (SEEN[b.id] ?? 0);
export function markSeen(id) { const b = S.blocks[id]; if (b && unseen(b)) { seenNow(b); emit(); } }

// upd is the object's version: wall clock, but always above the version this window last saw, so an edit made after
// seeing a collaborator's change wins even when this device's clock is behind (a hybrid logical clock, per object).
export function put(kind, obj) {
  obj.upd = Math.max(Date.now(), (S[kind][obj.id]?.upd || 0) + 1);
  S[kind][obj.id] = kind === 'blocks' ? live(obj) : obj;
  T.send({ t: 'put', kind, obj, epoch });
  emit();
}

// First snapshot: load. Later ones (after a reconnect): same epoch → keep and resend what this window changed while
// disconnected; new epoch → the notebook was reset meanwhile, take it as is.
function snapshot(d) {
  if (d.y) Y.applyUpdate(ydoc, unb64(d.y), 'remote');
  const old = S, same = old && d.epoch === epoch;
  if (same) yq.push(Y.encodeStateAsUpdate(ydoc)); // typing done while disconnected (the server ignores what it has)
  awDirty = true; ySoon();
  S = d.S; epoch = d.epoch; Object.values(S.blocks).forEach(live);
  if (same) for (const kind of ['blocks', 'actions']) for (const o of Object.values(old[kind]))
    if (!(S[kind][o.id]?.upd >= o.upd)) { S[kind][o.id] = o; T.send({ t: 'put', kind, obj: o, epoch }); }
  if (!SEEN || (old && !same)) { initSeen(); ui.SOURCE = ui.TGTNODE = null; }
  resolveReady(); emit();
}
const plain = b => b.kind === 'h' ? b.text : segs(b.id).map(s => s.v).join('');
function onMsg(d) {
  if (d.t === 'snapshot') return snapshot(d);
  if (d.t === 'y') {
    try {
      if (d.u) Y.applyUpdate(ydoc, unb64(d.u), 'remote');
      if (d.aw) { // a collaborator's colour comes from their name here, never from what their client sent
        applyAwarenessUpdate(awareness, unb64(d.aw), 'remote');
        for (const st of awareness.getStates().values()) if (st?.user) { st.user.color = hexcol(String(st.user.name ?? '?')); delete st.user.colorLight; }
      }
      if (d.gone != null) removeAwarenessStates(awareness, [d.gone], 'remote');
    } catch (e) { console.warn('bad Y.js message', e); }
    return;
  }
  if (d.t === 'presence') { ui.PRES[d.user] = d.b; return emit(); }
  if (d.t === 'cursor') { ui.cursors && d.c ? CUR[d.user] = d.c : delete CUR[d.user]; return cursorsChanged(); }
  if (d.t === 'busy') { d.label ? ui.BUSY[d.id] = `${d.label} (${d.user})` : delete ui.BUSY[d.id]; return emit(); }
  if (d.t === 'reset') { epoch = d.epoch; return hardReset(d.S); }
  if (d.t !== 'put' || !S) return;
  const cur = S[d.kind][d.obj.id];
  if (cur && cur.upd > d.obj.upd) return;
  S[d.kind][d.obj.id] = d.kind === 'blocks' ? live(d.obj) : d.obj; emit();
  if (d.kind === 'actions' && !cur && d.obj.owner === ME && d.obj.by !== ME) {
    const t = S.blocks[d.obj.tgt.b], seg = d.obj.tgt.n && t?.kind === 'p' && segs(t.id).find(s => s.id === d.obj.tgt.n);
    toast(`${d.obj.by} created a ${d.obj.type} on your ${t?.kind === 'h' ? 'task' : 'prompt'} “${seg ? seg.v : t ? plain(t) : '?'}”`);
  }
  const note = d.kind === 'blocks' && (d.obj.notes?.length || 0) > (cur?.notes?.length || 0) && d.obj.notes.at(-1);
  if (note && note.by !== ME) toast(`${note.by} commented on “${plain(d.obj) || 'a block'}”: ${note.text}`);
}
export function busy(id, label) {
  label ? ui.BUSY[id] = label : delete ui.BUSY[id];
  T.send({ t: 'busy', id, label, user: ME }); emit();
}
export const presence = id => T.send({ t: 'presence', user: ME, b: id });

// Prompt text (Y.js, lib/ytext.js). This window's changes go out at most every 100 ms, merged into one update,
// together with its text cursor; a remote change re-renders the app (wiki, labels) shortly after.
let yq = [], awDirty = false, yTimer = null;
export function yFlush() {
  clearTimeout(yTimer); yTimer = null;
  if (!T || (!yq.length && !awDirty)) return;
  const m = { t: 'y', id: ydoc.clientID };
  if (yq.length) m.u = b64(Y.mergeUpdates(yq));
  if (awDirty) m.aw = b64(encodeAwarenessUpdate(awareness, [ydoc.clientID]));
  yq = []; awDirty = false; T.send(m);
}
const ySoon = () => { yTimer ??= setTimeout(yFlush, 100); };
const emitSoon = debounce(emit, 100);
ydoc.on('update', (u, origin) => { if (origin !== 'remote') { yq.push(u); ySoon(); } emitSoon(); });
awareness.on('update', (_, origin) => { if (origin !== 'remote') { awDirty = true; ySoon(); } });

// Live mouse pointers (components/Cursors.jsx). Their own change counter, so ten moves a second from each
// collaborator never re-render the notebook.
export const CUR = {}; // user -> {a, x, y, k}: anchor element, position in it as fractions of its box, click count
const curSubs = new Set(); let curV = 0;
export const onCursors = f => { curSubs.add(f); return () => curSubs.delete(f); };
export const cursorsVersion = () => curV;
const cursorsChanged = () => { curV++; curSubs.forEach(f => f()); };
export const sendCursor = c => T.send({ t: 'cursor', user: ME, c });
export function setCursors(on) { // one switch: off means neither showing others' pointers nor sending mine
  ui.cursors = on; localStorage.setItem('cp_cursors', on ? '1' : '');
  if (!on) { for (const u in CUR) delete CUR[u]; cursorsChanged(); }
  emit();
}

// Connect. The room's owner (backend, or localStorage in local mode) decides whether our seed is used.
const status = s => { ui.conn = s; emit(); if (s !== 'reconnecting') T.send({ t: 'hello', seed: seed() }); };
const goLocal = () => { T = local(onMsg, status); };
if (LOCAL) goLocal(); else T = ws(onMsg, status, goLocal);

// a new notebook for a topic (lib/scenarios.js); the room keeps its topic in S.scenario
export function seed(topic = TOPIC) {
  const id = SCENARIOS[topic] ? topic : 'titanic', S = { blocks: {}, actions: {}, scenario: id }; let pos = 0;
  const H = (text, level, author) => { const id = uid(); S.blocks[id] = { id, pos: pos += 1000, kind: 'h', level, text, author, upd: 0 }; };
  const P = (t, author, code) => {
    const id = uid(), segs = [{ t: 'text', v: t }];
    S.blocks[id] = { id, pos: pos += 1000, kind: 'p', segs, author, editor: author, code, out: null, upd: 0,
      hist: [{ ts: Date.now(), by: author, action: 'add prompt', segs, code }] };
  };
  for (const [k, ...a] of SCENARIOS[id].blocks) k === 'h' ? H(...a) : P(...a);
  return S;
}
export function hardReset(newS) { S = newS; Object.values(S.blocks).forEach(live); initSeen(); ui.SOURCE = ui.TGTNODE = null; emit(); }
// the room's topic again. Sent before hardReset makes its code and titles live: the server writes them into Y.js
export function resetDemo() { const n = seed(S.scenario); T.send({ t: 'reset', S: n }); hardReset(n); }
