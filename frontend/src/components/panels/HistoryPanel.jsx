// History view (§6.1, Fig. 3e): versions of one prompt block (prompt-only edits included), with a diff and restore.
import { useState } from 'react';
import Icon from '../Icon.jsx';
import { Avatar } from '../bits.jsx';
import { PanelHead } from './ExplainPanel.jsx';
import { diff } from '../../lib/diff.js';
import { text } from '../../lib/model.js';
import { restoreVersion } from '../../lib/codegen.js';

export default function HistoryPanel({ b, onClose }) {
  const [sel, setSel] = useState(null);
  const vers = [...(b.hist || [])].reverse(), tok = s => s.split(/(\s+)/);
  const v = sel != null && vers.find(x => x.ts === sel);
  return <>
    <PanelHead title={`History (${vers.length})`} onClose={onClose} />
    {vers.map(x => <div key={x.ts} className={'hrow' + (x.ts === sel ? ' on' : '')} onClick={() => setSel(x.ts)}>
      <span className="muted">{new Date(x.ts).toLocaleTimeString()}</span><Avatar u={x.by} /><b>{x.action}</b>
      <span className="muted">{x.segs.map(s => s.v).join('').slice(0, 60)}</span></div>)}
    {v && <div>
      <p className="hint">Selected version → current. Red was removed, green was added.</p>
      <div className="xprompt">{diff(tok(v.segs.map(s => s.v).join('')), tok(text(b))).map(([o, t], i) => o === '=' ? t : <span key={i} className={o === '-' ? 'del' : 'ins'}>{t}</span>)}</div>
      <pre className="dcode">{diff(v.code.split('\n'), b.code.split('\n')).map(([o, t], i) =>
        <div key={i} className={o === '-' ? 'del' : o === '+' ? 'ins' : undefined}>{`${o === '=' ? ' ' : o} ${t}`}</div>)}</pre>
      <button onClick={() => { onClose(); restoreVersion(b.id, v); }}><Icon name="reset" />Restore this version</button>
    </div>}
  </>;
}
