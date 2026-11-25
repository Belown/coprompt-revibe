// Structural edits of the block editor: add, move, delete, headings.
import { S, ui, put } from './store.js';
import { ME } from './util.js';
import { ordered, text, section } from './model.js';
import { toast, ask } from './ui.js';
import { setSegs } from './ytext.js';
import { uid } from './util.js';

// kind: 'p' block (prompt + code; code-first is the same block, written from its code area), 'h' heading
export function addBlock(kind, afterId) {
  const list = ordered(), i = list.findIndex(b => b.id === afterId), cur = list[i], next = list[i + 1];
  const pos = !cur ? (list.at(-1)?.pos || 0) + 1000 : next ? (cur.pos + next.pos) / 2 : cur.pos + 1000;
  const id = uid();
  const level = list.slice(0, i + 1).findLast(x => x.kind === 'h')?.level ?? 1; // a sibling of the heading above
  const b = kind === 'h' ? { id, pos, kind, level, text: '', author: ME }
    : { id, pos, kind: 'p', author: ME, editor: ME, code: '', out: null, hist: [] }; // its text lives in Y.js (lib/ytext.js)
  ui.focus = { id, part: kind === 'h' ? 'heading' : 'prompt' };
  put('blocks', b);
  return id;
}
// drag-and-drop reordering. A heading takes its section with it; dropping it inside its own section is refused.
export function moveBlock(id, refId, after) {
  const b = S.blocks[id], group = [b, ...(b.kind === 'h' ? section(id) : [])];
  if (group.some(x => x.id === refId)) return;
  const list = ordered().filter(x => !group.includes(x)), i = list.findIndex(x => x.id === refId); if (i < 0) return;
  const [p, n] = after ? [list[i], list[i + 1]] : [list[i - 1], list[i]], k = group.length + 1;
  const lo = p ? p.pos : n.pos - 1000 * k, hi = n ? n.pos : p.pos + 1000 * k;
  group.forEach((x, j) => { x.pos = lo + (hi - lo) * (j + 1) / k; put('blocks', x); });
}
export function deleteBlock(id) {
  const b = S.blocks[id]; b.del = true; put('blocks', b);
  toast(`Deleted “${text(b) || 'untitled'}”`, { ms: 8000, action: { label: 'Undo', fn: () => { const x = S.blocks[id]; x.del = false; put('blocks', x); } } });
}
// Tab / Shift+Tab: move a heading one level in (d=1) or out (d=-1), its subheadings with it.
// In goes at most one level below the heading above it, out stops at the top level.
export function indent(id, d) {
  const list = ordered(), i = list.findIndex(x => x.id === id), b = list[i];
  const above = list.slice(0, i).findLast(x => x.kind === 'h'), lv = b.level + d;
  if (lv < 1 || lv > (above?.level ?? 0) + 1) return false;
  for (const x of [b, ...section(id).filter(x => x.kind === 'h')]) { x.level += d; put('blocks', x); }
  return true;
}
// the H1/H2/H3 chip: one level in per click, back out to H1 once it cannot go deeper
export function cycleLevel(id) { if (!indent(id, 1)) while (indent(id, -1)); }
// the avatar on a task (heading): a free task is taken, your own is given up, someone else's is taken over after asking.
// Whoever has it answers the requests and shares made on it, and its starting prompts are theirs.
export async function claim(id) {
  const who = S.blocks[id].author;
  if (who && who !== ME && !await ask(`Requests and shares on “${text(S.blocks[id]) || 'this task'}” will come to you instead of ${who}.`,
    { title: `Take over ${who}’s task?`, ok: 'Take it over' })) return;
  const b = S.blocks[id]; b.author = who === ME ? null : ME; put('blocks', b);
}
export function setPromptText(id, t) { setSegs(id, t ? [{ t: 'text', v: t }] : []); const b = S.blocks[id]; b.editor = ME; put('blocks', b); }
