// History view (§6.1, Fig. 3e), git-like: a timeline of a prompt block's versions, one node per version in its author's colour.
// Picking a node shows that version as a commit: what the action changed, the version before on the left and it on the right,
// side by side with line numbers, hatched gaps and an overview ruler. The prompt is the first row, as in the paper's figure.
import { useState } from 'react';
import Icon from '../Icon.jsx';
import { PanelHead } from './ExplainPanel.jsx';
import { diff } from '../../lib/diff.js';
import { MECH, ucol } from '../../lib/util.js';
import { restoreVersion } from '../../lib/codegen.js';

const ptext = v => v ? v.segs.map(s => s.v).join('') : '';
const tok = s => s.split(/(\s+)/);

// side-by-side rows from a line diff: a run of removed lines pairs up with the run of added lines after it, the shorter side gets gaps
function rows(a, b) {
  const out = [], ops = diff(a, b);
  for (let i = 0; i < ops.length;) {
    if (ops[i][0] === '=') { out.push({ l: ops[i][1], r: ops[i][1] }); i++; continue; }
    const del = [], ins = [];
    while (i < ops.length && ops[i][0] === '-') del.push(ops[i++][1]);
    while (i < ops.length && ops[i][0] === '+') ins.push(ops[i++][1]);
    for (let k = 0; k < Math.max(del.length, ins.length); k++) out.push({ l: del[k], r: ins[k], ch: true });
  }
  return out;
}
// one side of a changed line (a), with the words the other side (b) lacks marked
function Words({ a, b }) {
  if (b == null) return a;
  return diff(tok(a), tok(b)).filter(([o]) => o !== '+').map(([o, t], i) => o === '=' ? t : <mark key={i}>{t}</mark>);
}

export default function HistoryPanel({ b, onClose }) {
  const vers = b.hist || [], [sel, setSel] = useState(vers.length - 1);
  if (!vers.length) return <><PanelHead title="History" onClose={onClose} /><p className="muted">No versions yet.</p></>;
  const i = Math.min(sel, vers.length - 1), v = vers[i], prev = vers[i - 1];
  const prompt = { l: ptext(prev), r: ptext(v) }, code = rows(prev ? prev.code.split('\n') : [], v.code.split('\n'));
  const all = [{ l: prev ? prompt.l : null, r: prompt.r, ch: prompt.l !== prompt.r, p: true }, ...code];
  let nl = 0, nr = 0;
  const side = (x, s) => {
    const t = x[s], o = x[s === 'l' ? 'r' : 'l'];
    if (t == null) return <div className="hv-c gap" />;
    const n = x.p ? 'P' : s === 'l' ? ++nl : ++nr, sign = x.ch ? (s === 'l' ? '−' : '+') : '';
    return <div className={'hv-c' + (x.ch ? (s === 'l' ? ' del' : ' ins') : '') + (x.p ? ' prompt' : '')}>
      <span className="hv-n">{n}</span><span className="hv-s">{sign}</span>
      <span className="hv-t" title={t}>{x.ch ? <Words a={t} b={o} /> : t || ' '}</span></div>;
  };
  const who = v.by || 'system', when = new Date(v.ts).toLocaleTimeString();
  return <>
    <PanelHead title={`History (${vers.length})`} onClose={onClose} />
    <div className="hv">
      <div className="hv-top">
        <span className="hv-act" style={{ color: MECH[v.action]?.c }} title={v.action}><Icon name={MECH[v.action] ? v.action : 'pencil'} /></span>
        <i className="hv-p" title={prompt.r}>{prompt.r || '(empty prompt)'}</i>
        <div className="hv-line" role="listbox" aria-label="Versions, oldest first">
          {vers.map((x, k) => <button key={x.ts} role="option" aria-selected={k === i} className={'hv-v' + (k === i ? ' on' : '')}
            style={{ '--u': ucol(x.by) }} title={`${x.by || 'system'} · ${x.action} · ${new Date(x.ts).toLocaleTimeString()}`}
            onClick={() => setSel(k)}>{(x.by || '·')[0]}</button>)}
        </div>
      </div>
      <p className="hv-meta"><b style={{ color: ucol(v.by) }}>{who}</b> · {v.action} · {when}
        <span className="muted"> — {prev ? 'compared with the version before' : 'first version'}</span></p>
      <div className="hv-diff">
        <div className="hv-grid">{all.map((x, k) => <div key={k} className="hv-r">{side(x, 'l')}{side(x, 'r')}</div>)}</div>
        <div className="hv-ruler" aria-hidden="true">{all.map((x, k) => x.ch && <i key={k} className={x.r == null ? 'del' : x.l == null ? 'ins' : 'mod'}
          style={{ top: `${k / all.length * 100}%`, height: `${100 / all.length}%` }} />)}</div>
      </div>
      {i < vers.length - 1 && <button className="hv-restore" onClick={() => { onClose(); restoreVersion(b.id, v); }}>
        <Icon name="reset" />Restore this version</button>}
    </div>
  </>;
}
