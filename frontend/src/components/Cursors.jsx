// Other people's mouse pointers anywhere on the page, while "Live cursors" is on. A pointer is anchored to the nearest
// element both windows have (a block, a wiki row, or an element with an id: header buttons, panels, the editor),
// as fractions of its box, so it lands on the same thing whatever each person's window size or scroll.
// The button or row under a collaborator's pointer gets a box in their colour, and their clicks ripple.
// While this user has a dialog open (only they see it), their pointer is hidden for everyone else.
import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ui, CUR, onCursors, cursorsVersion, sendCursor } from '../lib/store.js';
import { ucol } from '../lib/util.js';
import { isModalOpen } from '../lib/ui.js';

const frac = v => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
const HOT = 'button, a[href], input, select, .node, .pill, .wrow'; // what gets a box under someone's pointer

// the element a pointer is anchored to, as 'b:<block>', 'w:<wiki row>' or 'id:<element id>' (backend/server.js checks it)
function anchorOf(el) {
  const a = el?.closest?.('[data-id], [data-bid], [id]');
  if (!a) return null;
  if (a.dataset.id && a.closest('#editor')) return ['b:' + a.dataset.id, a];
  if (a.dataset.bid) return ['w:' + a.dataset.bid, a];
  return /^[\w-]{1,64}$/.test(a.id) ? ['id:' + a.id, a] : null;
}
function resolve(anchor) {
  const [k, v] = [anchor.slice(0, anchor.indexOf(':')), anchor.slice(anchor.indexOf(':') + 1)];
  if (k === 'b') return document.querySelector(`#editor [data-id="${CSS.escape(v)}"]`);
  if (k === 'w') return document.querySelector(`[data-bid="${CSS.escape(v)}"]`);
  return document.getElementById(v);
}

export default function Cursors() {
  useSyncExternalStore(onCursors, cursorsVersion);
  const [, tick] = useState(0);
  const firstK = useRef({}); // click count when we first saw each user: a ripple only for clicks after that
  useEffect(() => { // scrolling or resizing here moves what the pointers sit on
    const f = () => tick(n => n + 1);
    window.addEventListener('scroll', f, true); window.addEventListener('resize', f);
    return () => { window.removeEventListener('scroll', f, true); window.removeEventListener('resize', f); };
  }, []);

  const dialog = isModalOpen();
  useEffect(() => { // send mine, at most 10 a second (the server drops a connection past 30); none while a dialog is open
    if (!ui.cursors || dialog) return;
    let pending = null, sent, timer = null, last = 0, pos = null, clicks = 0;
    const flush = () => {
      timer = null; last = Date.now();
      const k = JSON.stringify(pending);
      if (k !== sent) { sent = k; sendCursor(pending); }
    };
    const queue = c => { pending = c; timer ??= setTimeout(flush, Math.max(0, 100 - (Date.now() - last))); };
    const place = e => {
      const hit = anchorOf(e.target); if (!hit) return null;
      const r = hit[1].getBoundingClientRect(); if (!r.width || !r.height) return null;
      return { a: hit[0], x: frac((e.clientX - r.left) / r.width), y: frac((e.clientY - r.top) / r.height) };
    };
    const onMove = e => { const p = place(e); if (p) { pos = p; queue({ ...p, k: clicks }); } };
    const onDown = e => { const p = place(e) || pos; if (p) { pos = p; queue({ ...p, k: ++clicks }); } }; // a count, so a quick click is never lost
    const onOut = e => { if (!e.relatedTarget) { pos = null; queue(null); } }; // left the window
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('mouseout', onOut);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('mouseout', onOut);
      sendCursor(null);
    };
  }, [ui.cursors, dialog]); // opening a dialog runs the cleanup above, which hides the pointer at once

  if (!ui.cursors) return null;
  return Object.entries(CUR).map(([u, c]) => {
    const el = c.a && resolve(c.a);
    const r = el?.getBoundingClientRect();
    if (!r?.width || !r.height) return null; // not on this page here (a dialog or menu only they have open, a deleted block)
    const x = r.left + c.x * r.width, y = r.top + c.y * r.height;
    const hot = document.elementFromPoint(x, y)?.closest(HOT)?.getBoundingClientRect();
    if (!(u in firstK.current)) firstK.current[u] = c.k;
    const who = { '--who': ucol(u) };
    return <Fragment key={u}>
      {hot && <div className="cursor-box" aria-hidden="true"
        style={{ ...who, transform: `translate(${hot.left - 3}px, ${hot.top - 3}px)`, width: hot.width + 6, height: hot.height + 6 }} />}
      <div className="cursor" aria-hidden="true" style={{ ...who, transform: `translate(${x}px, ${y}px)` }}>
        {c.k !== firstK.current[u] && <i key={c.k} className="cursor-click" />}
        <svg viewBox="0 0 24 24"><path d="M4.04 4.69a.5.5 0 0 1 .65-.65l16 6.5a.5.5 0 0 1-.06.95l-6.13 1.58a2 2 0 0 0-1.43 1.43l-1.58 6.13a.5.5 0 0 1-.95.06z" /></svg>
        <span>{u}</span>
      </div>
    </Fragment>;
  });
}
