// Small shared pieces: avatar, action dots, mechanism tag, node chip (wiki), block controls.
import Icon from './Icon.jsx';
import { ucol, MECH } from '../lib/util.js';
import { addBlock, deleteBlock } from '../lib/blocks.js';

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

export const Ctl = ({ id, children }) => <span className="ctl">
  {children}
  <button title="Add prompt block below" onClick={() => addBlock('p', id)}><Icon name="plus" />prompt</button>
  <button title="Add code block below (write code first, prompt later)" onClick={() => addBlock('c', id)}><Icon name="plus" />code</button>
  <button title="Add heading below" onClick={() => addBlock('h', id)}><Icon name="plus" />heading</button>
  <button title="Delete" aria-label="Delete block" onClick={() => deleteBlock(id)}><Icon name="trash" /></button>
</span>;

// the grip arms native drag on the block; the rest of the block keeps normal text selection
export const Grip = ({ arm }) => <span className="grip" title="Drag to move" onMouseDown={() => arm(true)} onMouseUp={() => arm(false)}><Icon name="grip" /></span>;

export function Presence({ users }) {
  return <span className="presence" style={{ background: ucol(users[0]) }}>{users.length ? <><Icon name="pencil" />{users.join(', ')}</> : null}</span>;
}
