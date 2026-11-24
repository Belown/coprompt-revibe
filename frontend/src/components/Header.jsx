import { useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import Icon from './Icon.jsx';
import { Avatar } from './bits.jsx';
import { S, ui, resetDemo, setCursors } from '../lib/store.js';
import { scenario } from '../lib/scenarios.js';
import { ME, OTHER } from '../lib/util.js';
import { hasKey, openSettings } from '../lib/llm.js';
import { ask, toast, openModal } from '../lib/ui.js';
import { newRoom } from './Join.jsx';
import { ROOM } from '../config.js';

const CONN = { connecting: 'Connecting…', connected: 'Connected', reconnecting: 'Reconnecting…', local: 'Local mode' };
const CONN_TIP = {
  connected: 'Synced through the server with everyone in this room, on any device',
  reconnecting: 'Lost the server; your edits are kept and sent when it is back',
  local: 'No server: syncs only between windows of this browser',
};

// same room, server and mode, other user
const otherUrl = () => { const q = new URLSearchParams(location.search); q.set('user', OTHER); return '?' + q; };
// invite: a pop-up with the link to copy and a QR code to scan. Same session, no ?user=, so the invitee picks a name.
const inviteUrl = () => { const q = new URLSearchParams(location.search); q.delete('user'); return `${location.origin}${location.pathname}?${q}`; };
function qrSrc(url) {
  const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }));
}
function InviteBody({ url }) {
  const src = useMemo(() => qrSrc(url), [url]), [copied, setCopied] = useState(false);
  const copy = async e => {
    const input = e.currentTarget.previousElementSibling;
    try { await navigator.clipboard.writeText(url); setCopied(true); }
    catch { input.select(); toast('Press Ctrl+C to copy the selected link.'); } // no clipboard access (e.g. plain http)
  };
  return <div className="invite">
    <img className="qr" src={src} alt="QR code of the invite link" width="200" height="200" />
    <p className="muted">Scan it with a phone camera, or send the link. Whoever opens it picks a name and joins session <b>{ROOM}</b>.</p>
    <div className="copyrow">
      <input readOnly value={url} aria-label="Invite link" onFocus={e => e.target.select()} />
      <button onClick={copy}><Icon name={copied ? 'check' : 'copy'} />{copied ? 'Copied' : 'Copy'}</button>
    </div>
  </div>;
}
const invite = () => openModal({ title: 'Invite to this session', node: <InviteBody url={inviteUrl()} />, ok: 'Done', cancel: null });
// a new session opens the join screen in a new tab, where a topic is picked (the name is remembered)
const newSession = () => window.open(location.pathname, '_blank');

export default function Header() {
  const key = hasKey();
  const reset = async () => {
    if (await ask(`Clears the shared notebook in every open window and restores the starting notebook of “${scenario(S.scenario).title}”. This cannot be undone.`, { title: 'Reset the demo?', ok: 'Reset notebook' })) resetDemo();
  };
  return <header>
    <img className="logo" src="../favicon.svg" alt="" width="28" height="28" />
    <h1 className="brand">CoPrompt <small>revibe · CHI ’24</small></h1>
    <span id="me"><Avatar u={ME} /><span><span className="me-l">You are </span>{ME}</span></span>
    <span className="grow" />
    <span id="conn" data-s={ui.conn} title={CONN_TIP[ui.conn]}>{CONN[ui.conn]}</span>
    <span id="pystat" data-s={ui.py.s}>{ui.py.text}</span>
    <button id="cursors" aria-pressed={ui.cursors} onClick={() => setCursors(!ui.cursors)}
      title="Show other people’s mouse pointers and share yours. Off: neither."><Icon name="pointer" />Live cursors</button>
    <button id="invite" onClick={invite} title="Invite others: a link to copy, or a QR code to scan"><Icon name="share" />Invite</button>
    <button id="settings" className={key ? undefined : 'needs'} onClick={() => openSettings()}><Icon name="key" />{key ? 'API key' : 'Add API key'}</button>
    {/* session and demo controls: used now and then, so they live behind one button (native popover: Esc / outside click close it) */}
    <button id="morebtn" popoverTarget="more" title="Session and demo" aria-label="Session and demo"><Icon name="more" /></button>
    <div id="more" popover="auto" onClick={e => e.target.closest('button') && e.currentTarget.hidePopover()}>
      <p className="more-room">Session <code>{ROOM}</code></p>
      <button id="other" onClick={() => window.open(otherUrl(), OTHER, 'width=1100,height=900')}><Icon name="external" />Open as {OTHER}</button>
      <button id="newsession" onClick={newSession} title="Start a new session in a new tab, with a topic of your choice"><Icon name="plus" />New session</button>
      <hr />
      <button id="reset" onClick={reset}><Icon name="reset" />Reset demo…</button>
    </div>
  </header>;
}
