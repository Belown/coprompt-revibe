// Modal dialog, toasts, and the floating "Make node" button.
import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { ui } from '../lib/store.js';
import { emit } from '../lib/bus.js';
import { trimWs } from '../lib/util.js';
import { toasts, dismissToast, currentModal, closeModal, toast } from '../lib/ui.js';
import { chipEl, commitPrompt } from '../lib/promptDom.js';
import { uid } from '../lib/util.js';

export function Modal() {
  const m = currentModal(), ref = useRef(null);
  useEffect(() => { if (m) (ref.current.querySelector('input') || ref.current.querySelector('.primary')).focus(); }, [m?.id]);
  if (!m) return <div id="modal" hidden />;
  // inputs are uncontrolled; their values are read on confirm
  const done = ok => closeModal(m, ok ? Object.fromEntries([...ref.current.querySelectorAll('input[data-k]')].map(i => [i.dataset.k, i.value])) : null);
  return <div id="modal">
    <div key={m.id} ref={ref} className="dlg" role="dialog" aria-modal="true"
      onKeyDown={e => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); }}>
      {m.title && <h3>{m.title}</h3>}
      {m.body.map((t, i) => <p key={i}>{t}</p>)}
      {m.fields.map(f => f.label
        ? <label key={f.key}>{f.label}<input data-k={f.key} type={f.type} placeholder={f.placeholder} defaultValue={f.value} /></label>
        : <input key={f.key} data-k={f.key} placeholder={f.placeholder} defaultValue={f.value} aria-label={f.placeholder || m.title} />)}
      {m.note && <p className="muted">{m.note}</p>}
      <div className="btns"><button onClick={() => done(false)}>{m.cancel || 'Cancel'}</button><button className="primary" onClick={() => done(true)}>{m.ok || 'OK'}</button></div>
    </div>
  </div>;
}

export function Toasts() {
  return <div id="toast">{toasts.map(t => <div key={t.id} role={t.kind === 'err' ? 'alert' : 'status'} className={t.kind + (t.action ? ' act' : '')}>
    {t.kind === 'err' ? <Icon name="alert" /> : null}<span>{t.m}</span>
    {t.action ? <button onClick={() => { t.action.fn(); dismissToast(t.id); }}>{t.action.label}</button> : null}
  </div>)}</div>;
}

// floating "Make node" for a text selection inside one of the editor prompts; turns it into an atomic chip = source node
export function MakeNode() {
  const [pos, setPos] = useState(null);
  useEffect(() => {
    const onSel = () => {
      const s = getSelection(), r = s.rangeCount && !s.isCollapsed && s.getRangeAt(0);
      const ok = r && r.startContainer === r.endContainer && r.startContainer.nodeType === 3 && r.startContainer.parentElement.closest('#editor .prompt');
      if (!ok) return setPos(null);
      const rc = r.getBoundingClientRect(); setPos({ left: rc.left + scrollX, top: rc.top + scrollY - 40 });
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);
  const make = e => {
    e.preventDefault();
    const s = getSelection(); if (!s.rangeCount) return;
    const r = s.getRangeAt(0), p = r.startContainer.parentElement?.closest('.prompt'); if (!p) return;
    const id = p.closest('.block').dataset.id;
    const [a, z] = trimWs(r.startContainer.data, r.startOffset, r.endOffset); // Windows double-click grabs the trailing space
    if (a === z) return;
    r.setStart(r.startContainer, a); r.setEnd(r.startContainer, z);
    const nid = uid(), c = chipEl({ id: nid, v: r.toString() });
    r.deleteContents(); r.insertNode(c); s.removeAllRanges(); setPos(null);
    commitPrompt(id); ui.SOURCE = { b: id, n: nid }; emit();
    toast('Source node set. Now pick a target prompt in the Prompt Wiki →');
  };
  return <button id="mk" hidden={!pos} style={pos ? { left: pos.left, top: pos.top } : undefined} onMouseDown={make}><Icon name="node" />Make node</button>;
}
