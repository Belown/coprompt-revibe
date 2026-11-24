// Block-based editor (§6.1, Fig. 3a): headings and prompt blocks in order, reorderable by drag and drop.
import { useState } from 'react';
import Icon from './Icon.jsx';
import PromptBlock from './PromptBlock.jsx';
import HeadingBlock from './HeadingBlock.jsx';
import { ordered, depths, section } from '../lib/model.js';
import { S, ui } from '../lib/store.js';
import { addBlock, moveBlock } from '../lib/blocks.js';

export default function Editor() {
  const [dragging, setDragging] = useState(null), [drop, setDrop] = useState(null);
  const dnd = { dragging, drop, start: setDragging, end: () => { setDragging(null); setDrop(null); } };
  const onDragOver = e => {
    if (!dragging) return; e.preventDefault();
    const t = e.target.closest('#editor > .block');
    if (!t || t.dataset.id === dragging) return setDrop(null);
    const r = t.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
    if (drop?.id !== t.dataset.id || drop.after !== after) setDrop({ id: t.dataset.id, after });
  };
  const onDrop = e => { if (!dragging) return; e.preventDefault(); if (drop) moveBlock(dragging, drop.id, drop.after); dnd.end(); };
  // outline: each block sits one step in per enclosing heading. Hovering a heading (or making it the source)
  // lights its rail down the blocks a share or link of that section covers.
  const [hover, setHover] = useState(null);
  const list = ordered(), dep = depths(), hot = hover && S.blocks[hover] ? hover : S.blocks[ui.SOURCE?.b]?.kind === 'h' ? ui.SOURCE.b : null;
  const lit = new Set(hot ? section(hot).map(x => x.id) : []);
  const rail = id => ({ '--d': dep[id], ...(lit.has(id) && { '--hd': dep[hot], '--on': 1 }) });
  const onMouseOver = e => { const h = e.target.closest('.hb')?.dataset.id ?? null; if (h !== hover) setHover(h); };
  return <section id="editor" onDragOver={onDragOver} onDrop={onDrop} onMouseOver={onMouseOver} onMouseLeave={() => setHover(null)}>
    {list.map(b => b.kind === 'h' ? <HeadingBlock key={b.id} b={b} dnd={dnd} rail={rail(b.id)} /> : <PromptBlock key={b.id} b={b} dnd={dnd} rail={rail(b.id)} />)}
    <div id="addbar">
      <button onClick={() => addBlock('p', list.at(-1)?.id)}><Icon name="plus" />Prompt block</button>
      <button onClick={() => addBlock('c', list.at(-1)?.id)}><Icon name="code" />Code block</button>
      <button onClick={() => addBlock('h', list.at(-1)?.id)}><Icon name="plus" />Heading</button>
    </div>
  </section>;
}
