// Block-based editor (§6.1, Fig. 3a): headings and prompt blocks in order, reorderable by drag and drop.
import { useState } from 'react';
import Icon from './Icon.jsx';
import PromptBlock from './PromptBlock.jsx';
import HeadingBlock from './HeadingBlock.jsx';
import { ordered } from '../lib/model.js';
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
  const list = ordered();
  return <section id="editor" onDragOver={onDragOver} onDrop={onDrop}>
    {list.map(b => b.kind === 'h' ? <HeadingBlock key={b.id} b={b} dnd={dnd} /> : <PromptBlock key={b.id} b={b} dnd={dnd} />)}
    <div id="addbar">
      <button onClick={() => addBlock('p', list.at(-1)?.id)}><Icon name="plus" />Prompt block</button>
      <button onClick={() => addBlock('c', list.at(-1)?.id)}><Icon name="code" />Code block</button>
      <button onClick={() => addBlock('h', list.at(-1)?.id)}><Icon name="plus" />Heading</button>
    </div>
  </section>;
}
