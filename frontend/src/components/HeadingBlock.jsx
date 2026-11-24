// Heading = a task in the multi-level outline. A whole section can be the source of a link or share (§8).
import { useLayoutEffect, useMemo, useRef, useState, useEffect } from 'react';
import Icon from './Icon.jsx';
import { Dots, Ctl, Grip, Presence } from './bits.jsx';
import { ui, presence } from '../lib/store.js';
import { ME, debounce, ucol } from '../lib/util.js';
import { actsOn } from '../lib/model.js';
import { indent, setHeadingText } from '../lib/blocks.js';
import { setSource } from '../lib/mechanisms.js';
import { DIRTY, caretToEnd } from '../lib/promptDom.js';

export default function HeadingBlock({ b, dnd, rail }) {
  const id = b.id, ref = useRef(null), [armed, arm] = useState(false);
  const commit = useMemo(() => debounce(() => { DIRTY.delete(id); setHeadingText(id, ref.current.textContent); }, 300), [id]);
  useLayoutEffect(() => { // uncontrolled text, synced unless you are typing in it
    const t = ref.current, focused = document.activeElement === t;
    if ((!focused || !DIRTY.has(id)) && t.textContent !== b.text) { t.textContent = b.text; if (focused) caretToEnd(t); }
  });
  useEffect(() => { if (ui.focus?.id === id) { ref.current.focus(); ui.focus = null; } });
  const others = Object.entries(ui.PRES).filter(([u, x]) => x === id && u !== ME).map(([u]) => u);
  const cls = ['block', 'hb', others.length && 'here', ui.SOURCE?.b === id && 'is-src', dnd.dragging === id && 'dragging',
    dnd.drop?.id === id && (dnd.drop.after ? 'drop-after' : 'drop-before')].filter(Boolean).join(' ');
  return <div className={cls} data-id={id} data-d={rail['--d']} style={{ '--who': ucol(others[0]), ...rail }} draggable={armed}
    onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); dnd.start(id); }}
    onDragEnd={() => { arm(false); dnd.end(); }}>
    <Grip arm={arm} />
    <div ref={ref} className="htext" contentEditable suppressContentEditableWarning title="Tab / Shift+Tab: move in or out a level"
      onInput={() => { DIRTY.add(id); commit(); }} onFocus={() => presence(id)} onBlur={() => presence(null)}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
        if (e.key === 'Tab') { e.preventDefault(); indent(id, e.shiftKey ? -1 : 1); }
      }} />
    <Dots types={[...new Set(actsOn(id).map(a => a.type))]} />
    <Presence users={others} />
    <Ctl id={id}>
      <button title="Move out a level (Shift+Tab)" aria-label="Move out a level" onClick={() => indent(id, -1)}><Icon name="left" /></button>
      <button title="Move in a level (Tab)" aria-label="Move in a level" onClick={() => indent(id, 1)}><Icon name="right" /></button>
      <button title="Use this whole section as the source (to link or share it)" onClick={() => setSource(id)}><Icon name="node" />source</button>
    </Ctl>
  </div>;
}
