// Small shared pieces: avatar, action dots, mechanism tag, node chip (wiki), block controls.
import { useState } from 'react';
import Icon from './Icon.jsx';
import { ucol, MECH, ME } from '../lib/util.js';
import { S } from '../lib/store.js';
import { section, owner } from '../lib/model.js';
import { addBlock, deleteBlock, moveBlock, claim } from '../lib/blocks.js';

export const Avatar = ({ u, title }) => <span className="av" style={{ background: ucol(u) }} title={title || u}>{(u || '?')[0]}</span>;

// action dot; the link dot is the link icon of §5: clicking it unlinks (handled globally in App)
export const Dot = ({ t }) => <i style={{ background: MECH[t].c }} title={t === 'link' ? 'Linked: click to unlink' : t} data-unlink={t === 'link' ? '' : undefined} />;
export const Dots = ({ types, children }) => <span className="dots">{types.map(t => <Dot key={t} t={t} />)}{children}</span>;
export const MechTag = ({ t }) => <><Icon name={t} />{t}</>;

export function Chip({ s, types, title, selected }) {
  return <span className={'node' + (selected ? ' tsel' : '')} contentEditable={false} data-n={s.id} data-v={s.v} title={title}
    style={types.length ? { borderColor: MECH[types[0]].c } : undefined}>
    {s.v}<span className="nd">{types.map(t => <Dot key={t} t={t} />)}</span>
  </span>;
}

// who does a task (heading): dashed "?" while it is free, faded while it only comes with the task around it
export function Owner({ b }) {
  const u = b.author, via = !u && owner(b.id);
  const tip = u === ME ? 'Your task. Click to give it up.' : u ? `${u}’s task. Click to take it over.`
    : via ? `Part of ${via === ME ? 'your' : via + '’s'} section. Click to take it yourself.` : 'Nobody has taken this task yet. Click to take it.';
  return <button className={'as' + (u ? '' : via ? ' via' : ' free')} aria-label={tip} onClick={() => claim(b.id)}><Avatar u={u || via || null} title={tip} /></button>;
}

export const Ctl = ({ id, children }) => <span className="ctl">
  {children}
  <button title="Add a block below: write a prompt, or write code and then Prompt from code" onClick={() => addBlock('p', id)}><Icon name="plus" />block</button>
  <button title="Add heading below" onClick={() => addBlock('h', id)}><Icon name="plus" />heading</button>
  <button title="Delete" aria-label="Delete block" onClick={() => deleteBlock(id)}><Icon name="trash" /></button>
</span>;

// the grip arms native drag on the block; the rest of the block keeps normal text selection
export const Grip = ({ arm }) => <span className="grip" title="Drag to move" onMouseDown={() => arm(true)} onMouseUp={() => arm(false)}><Icon name="grip" /></span>;

// Drag to reorder, in the editor and in the wiki (rows: rowSel, with data-id or data-bid). The id travels under its own
// type, never as text/plain, and the drag is handled in the capture phase, so the prompt, heading and code editors under
// the pointer never see it (they used to paste the id into themselves). resolve(id, after) may move the drop point.
const DT = 'application/x-coprompt-block';
export function useDnd(rowSel, resolve = id => id) {
  const [dragging, setDragging] = useState(null), [drop, setDrop] = useState(null);
  const end = () => { setDragging(null); setDrop(null); };
  const start = (e, id) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData(DT, id); setDragging(id); };
  const mine = e => { if (!dragging) return false; e.preventDefault(); e.stopPropagation(); return true; };
  const on = {
    onDragOverCapture: e => {
      if (!mine(e)) return;
      const t = e.target.closest(rowSel), id = t && (t.dataset.id || t.dataset.bid), b = S.blocks[dragging];
      if (!id || id === dragging || (b?.kind === 'h' && section(dragging).some(x => x.id === id))) return drop && setDrop(null);
      const r = t.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
      if (drop?.id !== id || drop.after !== after) setDrop({ id, after });
    },
    onDropCapture: e => { if (!mine(e)) return; if (drop) moveBlock(dragging, resolve(drop.id, drop.after), drop.after); end(); },
  };
  return { dragging, drop, start, end, on };
}

export function Presence({ users }) {
  return <span className="presence" style={{ background: ucol(users[0]) }}>{users.length ? <><Icon name="pencil" />{users.join(', ')}</> : null}</span>;
}
