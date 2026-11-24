// Other people's mouse pointers anywhere on the page, while "Live cursors" is on. A pointer is anchored to the nearest
// element both windows have (a block, a wiki row, or an element with an id: header buttons, panels, the editor),
// as fractions of its box, so it lands on the same thing whatever each person's window size or scroll.
// The button or row under a collaborator's pointer gets a box in their colour, and their clicks ripple.
// While this user has a dialog or the ⋯ menu open (only they see it), their pointer is hidden for everyone else and
// the button that opened it stays boxed, with their name, until it closes.
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
  const sync = useRef(null); // tells the sender below that a dialog or menu opened or closed
  useEffect(() => { sync.current?.(); }, [dialog]);
  useEffect(() => { // send mine, at most 10 a second (the server drops a connection past 30)
    if (!ui.cursors) return;
    let pending = null, sent, timer = null, last = 0, pos = null, clicks = 0, opener = null;
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
    const isOpen = () => isModalOpen() || !!document.querySelector(':popover-open');
    let wasOpen = isOpen();
    sync.current = () => {
      const o = isOpen(); if (o === wasOpen) return; wasOpen = o;
      // opened right after a click: hold a box on what was clicked; opened by itself (a share arriving): just hide
      queue(o && opener && Date.now() - opener.t < 2000 ? { ...opener.p, k: clicks, h: 1 } : null);
    };
    const onMove = e => { if (isOpen()) return; const p = place(e); if (p) { pos = p; queue({ ...p, k: clicks }); } };
    const onDown = e => { // a click count, so a quick click is never lost
      if (isOpen()) return;
      const p = place(e) || pos; if (!p) return;
      pos = p; opener = { p, t: Date.now() }; queue({ ...p, k: ++clicks });
    };
    const onOut = e => { if (!e.relatedTarget && !isOpen()) { pos = null; queue(null); } }; // left the window
    const onToggle = () => sync.current?.(); // a native popover (the ⋯ menu) opened or closed
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('mouseout', onOut);
    document.addEventListener('toggle', onToggle, true);
    return () => {
      clearTimeout(timer); sync.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('mouseout', onOut);
      document.removeEventListener('toggle', onToggle, true);
      sendCursor(null);
    };
  }, [ui.cursors]);

  if (!ui.cursors) return null;
  return Object.entries(CUR).map(([u, c]) => {
    const el = c.a && resolve(c.a);
    const r = el?.getBoundingClientRect();
    if (!r?.width || !r.height) return null; // not on this page here (a dialog or menu only they have open, a deleted block)
    const x = r.left + c.x * r.width, y = r.top + c.y * r.height;
    const hot = document.elementFromPoint(x, y)?.closest(HOT)?.getBoundingClientRect();
    if (!(u in firstK.current)) firstK.current[u] = c.k;
    const who = { '--who': ucol(u) };
    const box = hot && { ...who, transform: `translate(${hot.left - 3}px, ${hot.top - 3}px)`, width: hot.width + 6, height: hot.height + 6 };
    if (c.h) return box ? <div key={u} className="cursor-box held" aria-hidden="true" style={box}><b>{u}</b></div> : null; // their dialog or menu is open
    return <Fragment key={u}>
      {box && <div className="cursor-box" aria-hidden="true" style={box} />}
      <div className="cursor" aria-hidden="true" style={{ ...who, transform: `translate(${x}px, ${y}px)` }}>
        {c.k !== firstK.current[u] && <i key={c.k} className="cursor-click" />}
        <svg viewBox="0 0 24 24"><path d="M4.04 4.69a.5.5 0 0 1 .65-.65l16 6.5a.5.5 0 0 1-.06.95l-6.13 1.58a2 2 0 0 0-1.43 1.43l-1.58 6.13a.5.5 0 0 1-.95.06z" /></svg>
        <span>{u}</span>
      </div>
    </Fragment>;
  });
}
