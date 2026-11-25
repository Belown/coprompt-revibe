// Block-based editor (§6.1, Fig. 3a): headings and prompt blocks in order, reorderable by drag and drop.
import { useState } from 'react';
import { useDnd } from './bits.jsx';
import Icon from './Icon.jsx';
import PromptBlock from './PromptBlock.jsx';
import HeadingBlock from './HeadingBlock.jsx';
import { ordered, depths, section } from '../lib/model.js';
import { S, ui } from '../lib/store.js';
import { addBlock } from '../lib/blocks.js';

export default function Editor() {
  const dnd = useDnd('#editor > .block');
  // outline: each block sits one step in per enclosing heading. Hovering a heading (or making it the source)
  // lights its rail down the blocks a share or link of that section covers.
  const [hover, setHover] = useState(null);
  const list = ordered(), dep = depths(), hot = hover && S.blocks[hover] ? hover : S.blocks[ui.SOURCE?.b]?.kind === 'h' ? ui.SOURCE.b : null;
  const lit = new Set(hot ? section(hot).map(x => x.id) : []);
  const rail = id => ({ '--d': dep[id], ...(lit.has(id) && { '--hd': dep[hot], '--on': 1 }) });
  const onMouseOver = e => { const h = e.target.closest('.hb')?.dataset.id ?? null; if (h !== hover) setHover(h); };
  return <section id="editor" {...dnd.on} onMouseOver={onMouseOver} onMouseLeave={() => setHover(null)}>
    {list.map(b => b.kind === 'h' ? <HeadingBlock key={b.id} b={b} dnd={dnd} rail={rail(b.id)} /> : <PromptBlock key={b.id} b={b} dnd={dnd} rail={rail(b.id)} />)}
    <div id="addbar">
      <button title="Write a prompt, or write code and then Prompt from code" onClick={() => addBlock('p', list.at(-1)?.id)}><Icon name="plus" />Block</button>
      <button onClick={() => addBlock('h', list.at(-1)?.id)}><Icon name="plus" />Heading</button>
    </div>
  </section>;
}
