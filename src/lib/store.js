// Shared notebook state, synced between windows with BroadcastChannel + localStorage.
// ponytail: same-browser sync only (two windows on one machine), no server/CRDT; per-object last-writer-wins.
import { emit } from './bus.js';
import { uid, ME } from './util.js';
import { toast } from './ui.js';

const KEY = 'coprompt-state';
export let S = JSON.parse(localStorage.getItem(KEY) || 'null');
export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch { toast('Browser storage is full: changes still sync live but will not survive a reload. Use Reset demo.'); }
}
if (!S) { S = seed(); save(); } // persist now so a second window loads the same seed ids

// local (per-window) UI state that library code also needs
export const ui = {
  SOURCE: null,   // source node {b, n}; n null = whole prompt or whole section
  TGTNODE: null,  // target node clicked in the wiki
  BUSY: {}, PRES: {}, FOLD: new Set(),
  py: { text: 'Python: loading…', s: 'load' },
  focus: null,    // {id, part} to focus once the block is mounted
};
export const setUI = patch => { Object.assign(ui, patch); emit(); };

// What this user has already seen of each block (last version timestamp). Changes made by others, or made
// automatically by a mechanism while this user was away, stay highlighted until the user clicks the block (§5).
const SEEN_KEY = 'cp_seen_' + ME;
export const lastTs = b => b.hist?.at(-1)?.ts || 0;
let SEEN = JSON.parse(localStorage.getItem(SEEN_KEY) || 'null');
const saveSeen = () => localStorage.setItem(SEEN_KEY, JSON.stringify(SEEN));
function initSeen() { SEEN = {}; for (const b of Object.values(S.blocks)) SEEN[b.id] = lastTs(b); saveSeen(); }
if (!SEEN) initSeen();
export function seenNow(b) { SEEN[b.id] = lastTs(b); saveSeen(); }
export const unseen = b => b.kind === 'p' && !b.del && lastTs(b) > (SEEN[b.id] ?? 0);
export function markSeen(id) { const b = S.blocks[id]; if (b && unseen(b)) { seenNow(b); emit(); } }

const bc = new BroadcastChannel('coprompt');
export function put(kind, obj) {
  obj.upd = Date.now();
  S[kind][obj.id] = obj; save();
  bc.postMessage({ kind, obj });
  emit();
}
const plain = b => b.kind === 'h' ? b.text : b.segs.map(s => s.v).join('');
bc.onmessage = ({ data: d }) => {
  if (d.kind === 'presence') { ui.PRES[d.user] = d.b; return emit(); }
  if (d.kind === 'busy') { d.label ? ui.BUSY[d.id] = `${d.label} (${d.user})` : delete ui.BUSY[d.id]; return emit(); }
  if (d.kind === 'reset') return hardReset(d.S);
  const cur = S[d.kind][d.obj.id];
  if (cur && cur.upd > d.obj.upd) return;
  S[d.kind][d.obj.id] = d.obj; save(); emit();
  if (d.kind === 'actions' && !cur && d.obj.owner === ME && d.obj.by !== ME) {
    const t = S.blocks[d.obj.tgt.b], seg = d.obj.tgt.n && t?.segs?.find(s => s.id === d.obj.tgt.n);
    toast(`${d.obj.by} created a ${d.obj.type} on your ${t?.kind === 'h' ? 'task' : 'prompt'} “${seg ? seg.v : t ? plain(t) : '?'}”`);
  }
  const note = d.kind === 'blocks' && (d.obj.notes?.length || 0) > (cur?.notes?.length || 0) && d.obj.notes.at(-1);
  if (note && note.by !== ME) toast(`${note.by} commented on “${plain(d.obj) || 'a block'}”: ${note.text}`);
};
export function busy(id, label) {
  label ? ui.BUSY[id] = label : delete ui.BUSY[id];
  bc.postMessage({ kind: 'busy', id, label, user: ME }); emit();
}
export const presence = id => bc.postMessage({ kind: 'presence', user: ME, b: id });

export function seed() {
  const S = { blocks: {}, actions: {} }; let pos = 0;
  const H = (text, level, author) => { const id = uid(); S.blocks[id] = { id, pos: pos += 1000, kind: 'h', level, text, author, upd: 0 }; };
  const P = (t, author, code) => {
    const id = uid(), segs = [{ t: 'text', v: t }];
    S.blocks[id] = { id, pos: pos += 1000, kind: 'p', segs, author, editor: author, code, out: null, upd: 0,
      hist: [{ ts: Date.now(), by: author, action: 'add prompt', segs, code }] };
  };
  H('Titanic Survival — Exploratory Data Analysis', 1, 'Alice');
  H('Data Preparation', 2, 'Alice');
  P('load data/titanic.csv into df', 'Alice', "import pandas as pd\ndf = pd.read_csv('data/titanic.csv')\ndf.head()");
  H('1. Deal with missing values in df', 3, 'Alice');
  H('2. Encode categorical features in df', 3, 'Alice');
  H('Feature Analysis', 2, 'Bob');
  H('3. Feature transformation', 3, 'Bob');
  H('4. Correlation analysis', 3, 'Bob');
  H('5. Deal with outliers', 3, 'Alice');
  return S;
}
export function hardReset(newS) { S = newS; save(); initSeen(); ui.SOURCE = ui.TGTNODE = null; emit(); }
export function resetDemo() { const n = seed(); hardReset(n); bc.postMessage({ kind: 'reset', S: n }); }
