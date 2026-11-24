import { useLayoutEffect, useMemo, useRef } from 'react';
import { S, ui, presence } from '../lib/store.js';
import { emit } from '../lib/bus.js';
import { ME, debounce } from '../lib/util.js';
import { generate, snapPrompt } from '../lib/codegen.js';
import { ask } from '../lib/ui.js';
import { put } from '../lib/store.js';
import { DIRTY, TYPED, fillPrompt, parsePrompt, caretToEnd, commitPrompt, decorateChip } from '../lib/promptDom.js';

// Uncontrolled contenteditable: React renders the shell, promptDom.js owns the text and chips inside.
export default function PromptInput({ b }) {
  const ref = useRef(null), id = b.id;
  const commit = useMemo(() => debounce(() => commitPrompt(id), 300), [id]);
  useLayoutEffect(() => {
    const p = ref.current;
    if (document.activeElement !== p) fillPrompt(p, b);
    else if (!DIRTY.has(id) && JSON.stringify(parsePrompt(p)) !== JSON.stringify(b.segs)) { fillPrompt(p, b); caretToEnd(p); } // remote change, no local typing
    p.querySelectorAll('.node').forEach(c => decorateChip(c, id));
  });
  return <div ref={ref} className="prompt" contentEditable suppressContentEditableWarning data-ph="Describe in plain English what this block should do…"
    onInput={() => { DIRTY.add(id); TYPED.add(id); commit(); }}
    onFocus={() => presence(id)}
    onBlur={() => { presence(null); if (TYPED.delete(id)) { if (DIRTY.has(id)) commitPrompt(id); snapPrompt(id); } }}
    onClick={e => { const c = e.target.closest('.node'); if (c) { ui.SOURCE = ui.SOURCE?.n === c.dataset.n ? null : { b: id, n: c.dataset.n }; emit(); } }}
    onDoubleClick={async e => { // rename a node (Fig. 7c), then regenerate this block
      const c = e.target.closest('.node'); if (!c) return;
      const v = (await ask('The block is regenerated with the new name; linked blocks follow.',
        { title: `Rename “${c.dataset.v}”`, input: true, value: c.dataset.v, ok: 'Rename' }))?.trim();
      if (!v || v === c.dataset.v) return;
      const x = S.blocks[id]; x.segs.find(s => s.id === c.dataset.n).v = v; x.editor = ME; put('blocks', x); generate(id);
    }}
    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitPrompt(id); generate(id); } }} />;
}
