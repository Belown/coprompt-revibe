// Message panel (§6.1, Fig. 3c): chronological log of actions; unprocessed ones pinned on top with a dot.
import Icon from './Icon.jsx';
import { Avatar, MechTag } from './bits.jsx';
import { S } from '../lib/store.js';
import { ME, MECH } from '../lib/util.js';
import { label, live, text } from '../lib/model.js';
import { setStatus, markActionSeen } from '../lib/mechanisms.js';
import { jump } from '../lib/promptDom.js';

const pending = a => (a.type === 'request' || a.type === 'share') ? a.status === 'open' : !a.seen.includes(ME);

function Line({ lbl, r, u }) {
  return <div className="mline"><span className="lbl">{lbl}</span><Avatar u={u} />
    <span><span className="jump" onClick={e => { e.stopPropagation(); jump(r.b, r.n); }}>“{label(r)}”</span>
      {r.n ? <span className="muted"> in “{text(S.blocks[r.b] || { kind: 'h', text: '?' })}”</span> : null}</span></div>;
}

export default function Messages() {
  const acts = Object.values(S.actions).sort((a, b) => (pending(b) - pending(a)) || a.ts - b.ts);
  const n = acts.filter(pending).length;
  const btn = (labelText, title, fn) => <button title={title} onClick={e => { e.stopPropagation(); fn(); }}>{labelText}</button>;
  return <section className="pane" id="msgCard">
    <h2 className="pane-h"><Icon name="inbox" />Messages <span id="msgCount">{n ? `${n} new` : ''}</span></h2>
    <div className="pane-b"><div id="msgs">{acts.length ? acts.map(a =>
      <div key={a.id} className={'msg' + (pending(a) ? ' new' : '')} onClick={() => markActionSeen(a.id)}>
        <div className="mtop">
          {pending(a) ? <span className="udot" title="Needs attention" /> : null}
          <span className="mtype" style={{ color: MECH[a.type].c }}><MechTag t={a.type} /></span>
          <span className="mstat" data-s={a.status} title={a.type === 'request' && a.status === 'fulfilled' ? 'Still tracked: later changes are checked again' : undefined}>{a.status}</span>
          <span className="grow" />
          {a.type === 'link' && live(a) ? btn('Unlink', 'Stop syncing', () => setStatus(a.id, 'unlinked')) : null}
          {a.type === 'request' && live(a) && a.by === ME ? btn('Stop tracking', 'Stop checking this request', () => setStatus(a.id, 'closed')) : null}
          <span className="mtime">{new Date(a.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <Line lbl="From" r={a.src} u={a.by} /><Line lbl="To" r={a.tgt} u={a.owner} />
        {a.msg ? <div className="mmsg">{a.msg}</div> : null}
      </div>)
      : <p className="empty">No actions yet. Select a phrase in one of your prompts, choose <b>Make node</b>, then pick refer, request, share or link on a target in the Prompt Wiki.</p>}
    </div></div>
  </section>;
}
