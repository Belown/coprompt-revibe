// Other people's mouse pointers, while "Live cursors" is on. A pointer is anchored to the block under it (position as
// fractions of the block's box), so it lands on the same content whatever each person's window size or scroll.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { ui, CUR, onCursors, cursorsVersion, sendCursor } from '../lib/store.js';
import { ucol } from '../lib/util.js';

const frac = v => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;

export default function Cursors() {
  useSyncExternalStore(onCursors, cursorsVersion);
  const [, tick] = useState(0);
  useEffect(() => { // scrolling or resizing here moves the blocks the pointers sit on
    const f = () => tick(n => n + 1);
    window.addEventListener('scroll', f, true); window.addEventListener('resize', f);
    return () => { window.removeEventListener('scroll', f, true); window.removeEventListener('resize', f); };
  }, []);

  useEffect(() => { // send mine, at most 10 a second (the server drops a connection past 20)
    if (!ui.cursors) return;
    let pending = null, sent, timer = null, last = 0;
    const flush = () => {
      timer = null; last = Date.now();
      const k = JSON.stringify(pending);
      if (k !== sent) { sent = k; sendCursor(pending); }
    };
    const queue = c => { pending = c; timer ??= setTimeout(flush, Math.max(0, 100 - (Date.now() - last))); };
    const onMove = e => {
      const el = e.target.closest?.('[data-id]');
      if (el) {
        const r = el.getBoundingClientRect();
        queue({ b: el.dataset.id, x: frac((e.clientX - r.left) / r.width), y: frac((e.clientY - r.top) / r.height) });
      } else if (e.target.closest?.('header, aside')) queue(null); // in the gaps between blocks it stays put
    };
    const onOut = e => { if (!e.relatedTarget) queue(null); }; // left the window
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseout', onOut);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseout', onOut);
      sendCursor(null);
    };
  }, [ui.cursors]);

  if (!ui.cursors) return null;
  return Object.entries(CUR).map(([u, c]) => {
    const el = document.querySelector(`[data-id="${CSS.escape(c.b)}"]`);
    if (!el) return null; // block deleted, or not rendered here
    const r = el.getBoundingClientRect();
    return <div key={u} className="cursor" aria-hidden="true"
      style={{ '--who': ucol(u), transform: `translate(${r.left + c.x * r.width}px, ${r.top + c.y * r.height}px)` }}>
      <svg viewBox="0 0 24 24"><path d="M4.04 4.69a.5.5 0 0 1 .65-.65l16 6.5a.5.5 0 0 1-.06.95l-6.13 1.58a2 2 0 0 0-1.43 1.43l-1.58 6.13a.5.5 0 0 1-.95.06z" /></svg>
      <span>{u}</span>
    </div>;
  });
}
