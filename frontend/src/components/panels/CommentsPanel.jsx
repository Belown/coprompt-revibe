// Annotation (§6.2: "functions commonly used in collaboration interfaces (e.g., annotation and history view)";
// the speech-bubble button of Fig. 3). A comment thread per prompt block, synced like everything else.
import { useEffect, useRef } from 'react';
import Icon from '../Icon.jsx';
import { Avatar } from '../bits.jsx';
import { PanelHead } from './ExplainPanel.jsx';
import { S, put } from '../../lib/store.js';
import { ME, uid } from '../../lib/util.js';

export default function CommentsPanel({ b, onClose }) {
  const inp = useRef(null), ns = b.notes || [];
  useEffect(() => inp.current.focus(), []);
  const send = () => {
    const t = inp.current.value.trim(); if (!t) return;
    const x = S.blocks[b.id]; x.notes = [...(x.notes || []), { id: uid(), by: ME, ts: Date.now(), text: t }]; inp.current.value = ''; put('blocks', x);
  };
  const remove = nid => { const x = S.blocks[b.id]; x.notes = x.notes.filter(n => n.id !== nid); put('blocks', x); };
  return <>
    <PanelHead title="Comments" onClose={onClose} />
    <div className="nlist">{ns.length ? ns.map(n => <div key={n.id} className="note">
      <Avatar u={n.by} />
      <div><b>{n.by}</b> <span className="mtime">{new Date(n.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span><div>{n.text}</div></div>
      {n.by === ME ? <button title="Delete comment" aria-label="Delete comment" onClick={() => remove(n.id)}><Icon name="x" /></button> : <span />}
    </div>) : <p className="hint">No comments yet.</p>}</div>
    <div className="nform">
      <input ref={inp} placeholder="Comment for your collaborators…" aria-label="Comment" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); send(); } }} />
      <button onClick={send}>Comment</button>
    </div>
  </>;
}
