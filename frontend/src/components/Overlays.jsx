// Modal dialog and toasts.
import { useEffect, useRef } from 'react';
import Icon from './Icon.jsx';
import { toasts, dismissToast, currentModal, closeModal } from '../lib/ui.js';

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
