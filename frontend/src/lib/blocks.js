// Structural edits of the block editor: add, move, delete, headings.
import { S, ui, put } from './store.js';
import { ME } from './util.js';
import { ordered, text } from './model.js';
import { toast } from './ui.js';
import { uid } from './util.js';

// kind: 'p' prompt block, 'c' code-first block (a prompt block that starts in its code area), 'h' heading
export function addBlock(kind, afterId) {
  const list = ordered(), i = list.findIndex(b => b.id === afterId), cur = list[i], next = list[i + 1];
  const pos = !cur ? (list.at(-1)?.pos || 0) + 1000 : next ? (cur.pos + next.pos) / 2 : cur.pos + 1000;
  const id = uid();
  const b = kind === 'h' ? { id, pos, kind, level: 3, text: '', author: ME }
    : { id, pos, kind: 'p', segs: [], author: ME, editor: ME, code: '', out: null, hist: [] };
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
export function cycleLevel(id) { const b = S.blocks[id]; b.level = b.level % 3 + 1; put('blocks', b); }
export function setHeadingText(id, t) { const b = S.blocks[id]; b.text = t; put('blocks', b); }
export function setPromptText(id, t) { const b = S.blocks[id]; b.segs = t ? [{ t: 'text', v: t }] : []; b.editor = ME; put('blocks', b); }
