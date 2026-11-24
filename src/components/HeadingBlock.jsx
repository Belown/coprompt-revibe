// Heading = a task in the multi-level outline. A whole section can be the source of a link or share (§8).
import { useLayoutEffect, useMemo, useRef, useState, useEffect } from 'react';
import Icon from './Icon.jsx';
import { Dots, Ctl, Grip, Presence } from './bits.jsx';
import { ui, presence } from '../lib/store.js';
import { ME, debounce, ucol } from '../lib/util.js';
import { actsOn } from '../lib/model.js';
import { cycleLevel, setHeadingText } from '../lib/blocks.js';
import { setSource } from '../lib/mechanisms.js';
import { DIRTY, caretToEnd } from '../lib/promptDom.js';

export default function HeadingBlock({ b, dnd }) {
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
  return <div className={cls} data-id={id} data-l={b.level} style={{ '--who': ucol(others[0]) }} draggable={armed}
    onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); dnd.start(id); }}
    onDragEnd={() => { arm(false); dnd.end(); }}>
    <Grip arm={arm} />
    <span className="lvl" title="Click to change level" onClick={() => cycleLevel(id)}>H{b.level}</span>
    <div ref={ref} className="htext" contentEditable suppressContentEditableWarning
      onInput={() => { DIRTY.add(id); commit(); }} onFocus={() => presence(id)} onBlur={() => presence(null)}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }} />
    <Dots types={[...new Set(actsOn(id).map(a => a.type))]} />
    <Presence users={others} />
    <Ctl id={id}><button title="Use this whole section as the source (to link or share it)" onClick={() => setSource(id)}><Icon name="node" />source</button></Ctl>
  </div>;
}
