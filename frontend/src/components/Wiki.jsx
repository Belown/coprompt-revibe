// Prompt Wiki (§6.1, Fig. 3b): foldable tree of headings → prompts → nodes; picks the target of a mechanism.
import Icon from './Icon.jsx';
import { Avatar, Dots, Chip, MechTag } from './bits.jsx';
import { S, ui } from '../lib/store.js';
import { emit } from '../lib/bus.js';
import { MECH } from '../lib/util.js';
import { ordered, actsOn, label } from '../lib/model.js';
import { mech } from '../lib/mechanisms.js';
import { jump } from '../lib/promptDom.js';

const types = (b, n) => [...new Set(actsOn(b, n).map(a => a.type))];

function Pills({ b }) { // a section (heading) as source can only be linked or shared; refer/request rebuild one prompt
  const kinds = S.blocks[ui.SOURCE?.b]?.kind === 'h' ? ['share', 'link'] : ['refer', 'request', 'share', 'link'];
  return <span className="pills">{kinds.map(t => <button key={t} className="pill" style={{ '--c': MECH[t].c }} title={MECH[t].tip}
    onMouseDown={e => { e.preventDefault(); mech(t, b.id, e.currentTarget.closest('.wrow')); }}><MechTag t={t} /></button>)}</span>;
}

export default function Wiki() {
  const src = ui.SOURCE, secSrc = S.blocks[src?.b]?.kind === 'h';
  const rows = []; let hl = 0, hideAt = null;
  for (const b of ordered()) {
    if (b.kind === 'h' && hideAt !== null && b.level <= hideAt) hideAt = null;
    if (hideAt !== null) continue;
    if (b.kind === 'h') {
      hl = b.level; const folded = ui.FOLD.has(b.id);
      const fold = () => { folded ? ui.FOLD.delete(b.id) : ui.FOLD.add(b.id); emit(); };
      rows.push(<div key={b.id} className="wrow wh" style={{ paddingLeft: (b.level - 1) * 14 + 4 }} data-bid={b.id}>
        <span className="fold" role="button" tabIndex={0} aria-label={folded ? 'Expand' : 'Collapse'} aria-expanded={!folded} onClick={fold}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fold(); } }}><Icon name={folded ? 'right' : 'down'} /></span>
        <span className="hl">H{b.level}</span><Avatar u={b.author} />
        <span className="wtext" onClick={() => jump(b.id)}>{b.text || '(untitled)'}</span>
        <Dots types={types(b.id)}>{(b.ctx || []).length ? <i style={{ background: 'var(--share)' }} title="shared context attached" /> : null}</Dots>
        {src?.b === b.id ? <span className="srctag">source</span> : <Pills b={b} />}
      </div>);
      if (folded) hideAt = b.level;
    } else {
      rows.push(<div key={b.id} className={'wrow wp' + (src?.b === b.id ? ' is-src' : '')} style={{ paddingLeft: hl * 14 + 4 }} data-bid={b.id}>
        <Dots types={types(b.id)} />
        <Avatar u={b.editor || b.author} />
        <span className="wtext" onClick={e => {
          const c = e.target.closest('.node');
          if (c) { ui.TGTNODE = ui.TGTNODE?.n === c.dataset.n ? null : { b: b.id, n: c.dataset.n }; return emit(); }
          if (getSelection().isCollapsed) jump(b.id);
        }}>{b.segs.length ? b.segs.map((s, i) => s.t === 'node'
          ? <Chip key={s.id} s={s} types={types(b.id, s.id)} title="Click to target this node" selected={ui.TGTNODE?.n === s.id} />
          : <span key={i} data-si={i}>{s.v}</span>) : '(empty prompt)'}</span>
        {b.notes?.length ? <span className="wn" title={`${b.notes.length} comment(s)`}><Icon name="comment" />{b.notes.length}</span> : null}
        {src?.b === b.id ? <span className="srctag">source</span> : <Pills b={b} />}
      </div>);
    }
  }
  return <section className="pane" id="wikiCard">
    <h2 className="pane-h"><Icon name="tree" />Prompt Wiki</h2>
    <div className="pane-b">
      <div className="legend">{Object.keys(MECH).map(t => <span key={t} className="lg" style={{ '--c': MECH[t].c }} title={MECH[t].tip}><MechTag t={t} /></span>)}</div>
      <p className="howto">Select a phrase in your prompt and choose <b>Make node</b> (or use a whole prompt or section as the source), then pick a mechanism on a target below.</p>
      <div id="srcbar">{src && <><Icon name="node" /><span>{secSrc ? 'Source section ' : 'Source '}<code>{label(src)}</code>
        {secSrc ? ' — now pick share or link on a target below' : ' — now pick refer, request, share or link on a target below'}</span>
        <button title="Cancel (Esc)" aria-label="Cancel source node" onClick={() => { ui.SOURCE = null; emit(); }}><Icon name="x" /></button></>}</div>
      <div id="wiki" className={src ? 'picking' : undefined}>{rows}</div>
    </div>
  </section>;
}
