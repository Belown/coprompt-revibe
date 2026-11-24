// The prompt editor is a contenteditable whose nodes are atomic chips. React does not own its children:
// PromptInput fills and parses the DOM here, so remote updates never fight the person typing.
import { S, ui, put } from './store.js';
import { ME, MECH } from './util.js';
import { actsOn } from './model.js';

export const DIRTY = new Set(); // blocks with local typing not yet committed
export const TYPED = new Set(); // blocks typed into since focus (for prompt-only history versions)

export function chipEl(s, title = 'Click: use as source node · Double-click: rename') {
  const c = document.createElement('span');
  Object.assign(c, { className: 'node', contentEditable: 'false', title });
  c.dataset.n = s.id; c.dataset.v = s.v;
  const nd = document.createElement('span'); nd.className = 'nd';
  c.append(s.v, nd);
  return c;
}
export function dotEl(t) {
  const i = document.createElement('i');
  i.style.background = MECH[t].c; i.title = t === 'link' ? 'Linked: click to unlink' : t;
  if (t === 'link') i.dataset.unlink = '';
  return i;
}
export function decorateChip(c, bid) {
  const types = [...new Set(actsOn(bid, c.dataset.n).map(a => a.type))];
  c.querySelector('.nd')?.replaceChildren(...types.map(dotEl));
  c.style.borderColor = types.length ? MECH[types[0]].c : '';
  c.classList.toggle('src', ui.SOURCE?.n === c.dataset.n);
}
export function fillPrompt(div, b) { div.replaceChildren(...b.segs.map(s => s.t === 'node' ? chipEl(s) : document.createTextNode(s.v))); }
export function parsePrompt(div) {
  const segs = [];
  for (const n of div.childNodes) {
    if (n.dataset?.n) segs.push({ t: 'node', id: n.dataset.n, v: n.dataset.v });
    else { const v = n.textContent; if (segs.at(-1)?.t === 'text') segs.at(-1).v += v; else segs.push({ t: 'text', v }); }
  }
  return segs.filter(s => s.t === 'node' || s.v);
}
export function caretToEnd(el) { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
export const promptEl = id => document.querySelector(`[data-id="${id}"] .prompt`);
export function commitPrompt(id) {
  DIRTY.delete(id);
  const b = S.blocks[id], el = promptEl(id); if (!b || !el) return;
  b.segs = parsePrompt(el); b.editor = ME; put('blocks', b);
}

// motion through the Web Animations API, so React re-rendering className never cuts an animation short
const EASE = 'cubic-bezier(.16,1,.3,1)';
export function flash(el, c = 'var(--accent)') {
  el?.animate([
    { boxShadow: `0 0 0 0 color-mix(in srgb, ${c} 60%, transparent)`, borderColor: c },
    { boxShadow: `0 0 0 7px color-mix(in srgb, ${c} 22%, transparent)`, borderColor: c, offset: .3 },
    { boxShadow: '0 0 0 14px transparent' }], { duration: 1500, easing: EASE });
}
export function jump(id, n) { // scroll to a block; with a node id, also pulse that node
  const el = document.querySelector(`#editor [data-id="${id}"]`); if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' }); flash(el);
  el.querySelector(`.node[data-n="${n}"]`)?.animate([{ boxShadow: '0 0 0 0 var(--accent)' }, { boxShadow: '0 0 0 12px transparent' }], { duration: 1400, easing: EASE });
}
