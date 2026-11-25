// Structural edits of the block editor: add, move, delete, headings.
import { S, ui, put } from './store.js';
import { ME } from './util.js';
import { ordered, text, section } from './model.js';
import { toast } from './ui.js';
import { setSegs } from './ytext.js';
import { uid } from './util.js';

// kind: 'p' prompt block, 'c' code-first block (a prompt block that starts in its code area), 'h' heading
export function addBlock(kind, afterId) {
  const list = ordered(), i = list.findIndex(b => b.id === afterId), cur = list[i], next = list[i + 1];
  const pos = !cur ? (list.at(-1)?.pos || 0) + 1000 : next ? (cur.pos + next.pos) / 2 : cur.pos + 1000;
  const id = uid();
  const level = list.slice(0, i + 1).findLast(x => x.kind === 'h')?.level ?? 1; // a sibling of the heading above
  const b = kind === 'h' ? { id, pos, kind, level, text: '', author: ME }
    : { id, pos, kind: 'p', author: ME, editor: ME, code: '', out: null, hist: [] }; // its text lives in Y.js (lib/ytext.js)
  ui.focus = { id, part: kind === 'h' ? 'heading' : kind === 'c' ? 'code' : 'prompt' };
  put('blocks', b);
  return id;
}
export function moveBlock(id, refId, after) { // drag-and-drop reordering
  if (id === refId) return;
  const list = ordered().filter(b => b.id !== id), i = list.findIndex(b => b.id === refId); if (i < 0) return;
  const [p, n] = after ? [list[i], list[i + 1]] : [list[i - 1], list[i]];
  const b = S.blocks[id]; b.pos = p && n ? (p.pos + n.pos) / 2 : p ? p.pos + 1000 : n.pos - 1000; put('blocks', b);
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
  if (lv < 1 || lv > (above?.level ?? 0) + 1) return;
  for (const x of [b, ...section(id).filter(x => x.kind === 'h')]) { x.level += d; put('blocks', x); }
}
export function setPromptText(id, t) { setSegs(id, t ? [{ t: 'text', v: t }] : []); const b = S.blocks[id]; b.editor = ME; put('blocks', b); }
