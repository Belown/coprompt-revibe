// Prompt Wiki (§6.1, Fig. 3b): foldable tree of headings → prompts → nodes; picks the target of a mechanism.
import Icon from './Icon.jsx';
import { Avatar, Dots, Chip, MechTag } from './bits.jsx';
import { S, ui } from '../lib/store.js';
import { emit } from '../lib/bus.js';
import { MECH } from '../lib/util.js';
import { ordered, actsOn, label, depths } from '../lib/model.js';
import { mech, targetKinds } from '../lib/mechanisms.js';
import { jump } from '../lib/promptDom.js';
import { segs } from '../lib/ytext.js';

const types = (b, n) => [...new Set(actsOn(b, n).map(a => a.type))];

// only the mechanisms this target accepts (none on the source or a row overlapping it). Icon pills: the source bar says what each does.
// mousedown is cancelled so a phrase selected in the row survives the click (it becomes the target node)
function Pills({ b, kinds }) {
  return <span className="pills">{kinds.map(t => <button key={t} className="pill" style={{ '--c': MECH[t].c }} title={MECH[t].tip}
    onMouseDown={e => e.preventDefault()} onClick={e => mech(t, b.id, e.currentTarget.closest('.wrow'))}>
    <Icon name={t} /><span className="vh">{t}</span></button>)}</span>;
}
// Enter on a focused row's text jumps to the block, like a click
const keyJump = id => e => { if (e.key === 'Enter') { e.preventDefault(); jump(id); } };

export default function Wiki() {
  const src = ui.SOURCE, secSrc = S.blocks[src?.b]?.kind === 'h';
  const rows = [], dep = depths(); let hideAt = null;
  const cls = (b, base) => { if (!src || src.b === b.id) return base; const k = targetKinds(b.id); return k.length ? base : base + ' nope'; };
  for (const b of ordered()) {
    if (b.kind === 'h' && hideAt !== null && b.level <= hideAt) hideAt = null;
    if (hideAt !== null) continue;
    if (b.kind === 'h') {
      const folded = ui.FOLD.has(b.id);
      const fold = () => { folded ? ui.FOLD.delete(b.id) : ui.FOLD.add(b.id); emit(); };
      rows.push(<div key={b.id} className={cls(b, 'wrow wh')} style={{ paddingLeft: dep[b.id] * 14 + 4 }} data-bid={b.id}>
        <span className="fold" role="button" tabIndex={0} aria-label={folded ? 'Expand' : 'Collapse'} aria-expanded={!folded} onClick={fold}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fold(); } }}><Icon name={folded ? 'right' : 'down'} /></span>
        <Avatar u={b.author} />
        <span className="wtext" tabIndex={0} onClick={() => jump(b.id)} onKeyDown={keyJump(b.id)}>{b.text || '(untitled)'}</span>
        <Dots types={types(b.id)}>{(b.ctx || []).length ? <i style={{ background: 'var(--share)' }} title="shared context attached" /> : null}</Dots>
        {src?.b === b.id ? <span className="srctag">source</span> : <Pills b={b} kinds={targetKinds(b.id)} />}
      </div>);
      if (folded) hideAt = b.level;
    } else {
      const sg = segs(b.id);
      rows.push(<div key={b.id} className={cls(b, 'wrow wp' + (src?.b === b.id ? ' is-src' : ''))} style={{ paddingLeft: dep[b.id] * 14 + 4 }} data-bid={b.id}>
        <Dots types={types(b.id)} />
        <Avatar u={b.editor || b.author} />
        <span className="wtext" tabIndex={0} onKeyDown={keyJump(b.id)} onClick={e => {
          const c = e.target.closest('.node');
          if (c) { ui.TGTNODE = ui.TGTNODE?.n === c.dataset.n ? null : { b: b.id, n: c.dataset.n }; return emit(); }
          if (getSelection().isCollapsed) jump(b.id);
        }}>{sg.length ? sg.map((s, i) => s.t === 'node'
          ? <Chip key={s.id} s={s} types={types(b.id, s.id)} title="Click to target this node" selected={ui.TGTNODE?.n === s.id} />
          : <span key={i} data-si={i}>{s.v}</span>) : '(empty prompt)'}</span>
        {b.notes?.length ? <span className="wn" title={`${b.notes.length} comment(s)`}><Icon name="comment" />{b.notes.length}</span> : null}
        {src?.b === b.id ? <span className="srctag">source</span> : <Pills b={b} kinds={targetKinds(b.id)} />}
      </div>);
    }
  }
  return <section className="pane" id="wikiCard">
    <h2 className="pane-h"><Icon name="tree" />Prompt Wiki</h2>
    <div className="pane-b">
      <div className="legend">{Object.keys(MECH).map(t => <span key={t} className="lg" style={{ '--c': MECH[t].c }} title={MECH[t].tip}><MechTag t={t} /></span>)}</div>
      <p className="howto">Select a phrase in your prompt and choose <b>Make node</b> (or use a whole prompt or section as the source), then pick a mechanism on a target below.</p>
      {/* sticky while you scroll the tree for a target: what the source is, and what each mechanism will do */}
      <div id="srcbar">{src && <>
        <div className="sb-top"><Icon name="node" /><span>{secSrc ? 'Source section ' : 'Source '}<code>{label(src)}</code></span>
          <button title="Cancel (Esc)" aria-label="Cancel source node" onClick={() => { ui.SOURCE = null; emit(); }}><Icon name="x" /></button></div>
        <dl className="sb-mechs">{(secSrc ? ['share', 'link'] : Object.keys(MECH)).map(t =>
          <div key={t} style={{ '--c': MECH[t].c }}><dt><Icon name={t} />{t}</dt><dd>{MECH[t].does}</dd></div>)}</dl>
        <p className="sb-hint">Pick one on a target below. Greyed rows overlap the source.</p>
      </>}</div>
      <div id="wiki" className={src ? 'picking' : undefined}>{rows}</div>
    </div>
  </section>;
}
