// Explanation view (§6.2.1, Fig. 3d): semantic highlighting linking prompt phrases to code lines, plus a list of steps.
import { useEffect, useState } from 'react';
import Icon from '../Icon.jsx';
import { llm } from '../../lib/llm.js';
import { T } from '../../lib/templates.js';
import { text } from '../../lib/model.js';

const COL = ['#fde68a', '#bfdbfe', '#fbcfe8', '#bbf7d0', '#ddd6fe', '#fed7aa'];
export const PanelHead = ({ title, onClose }) => <div className="phdr">{title}<button title="Close" aria-label="Close" onClick={onClose}><Icon name="x" /></button></div>;

export default function ExplainPanel({ b, onClose }) {
  const [st, setSt] = useState(null), [hi, setHi] = useState(null);
  useEffect(() => {
    let on = true;
    llm(T.explain(b), true).then(r => on && setSt({ steps: r.steps || [], P: text(b), code: b.code }), e => on && setSt({ err: e.message }));
    return () => { on = false; };
  }, []);
  if (!st) return <div className="busy" style={{ margin: 0 }}><Icon name="loader" />Explaining how the code implements the prompt…</div>;
  if (st.err) return <><PanelHead title="Explanation" onClose={onClose} /><div className="err">{st.err}</div></>;
  const { steps, P, code } = st, dim = i => hi != null && String(i) !== hi ? 'dim' : undefined;
  const marks = steps.map((s, i) => ({ at: s.phrase ? P.toLowerCase().indexOf(s.phrase.toLowerCase()) : -1, len: (s.phrase || '').length, i }))
    .filter(m => m.at >= 0).sort((x, y) => x.at - y.at);
  const prompt = []; let pos = 0;
  for (const m of marks) if (m.at >= pos) {
    prompt.push(P.slice(pos, m.at), <mark key={m.i} className={dim(m.i)} style={{ background: COL[m.i % 6] }} data-i={m.i}>{P.slice(m.at, m.at + m.len)}</mark>);
    pos = m.at + m.len;
  }
  prompt.push(P.slice(pos));
  const ls = {}; steps.forEach((s, i) => (s.lines || []).forEach(l => ls[l] ??= i));
  return <div onMouseOver={e => setHi(e.target.closest('[data-i]')?.dataset.i ?? null)}>
    <PanelHead title="Explanation (hover to trace)" onClose={onClose} />
    <div className="xprompt">{prompt}</div>
    <pre className="xcode">{code.split('\n').map((l, k) => ls[k + 1] != null
      ? <div key={k} className={dim(ls[k + 1])} style={{ background: COL[ls[k + 1] % 6] }} data-i={ls[k + 1]}>{`${String(k + 1).padStart(2)}  ${l}`}</div>
      : <div key={k}>{`${String(k + 1).padStart(2)}  ${l}`}</div>)}</pre>
    <ol className="xsteps">{steps.map((s, i) => <li key={i} className={dim(i)} data-i={i}><mark style={{ background: COL[i % 6] }}>{s.phrase || '—'}</mark> {s.explanation}</li>)}</ol>
  </div>;
}
