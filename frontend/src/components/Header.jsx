import Icon from './Icon.jsx';
import { Avatar } from './bits.jsx';
import { ui, resetDemo } from '../lib/store.js';
import { ME, OTHER } from '../lib/util.js';
import { hasKey, openSettings } from '../lib/llm.js';
import { ask, toast } from '../lib/ui.js';
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
// invite link: same session, no ?user=, so the invitee picks a name on the join screen
async function invite() {
  const q = new URLSearchParams(location.search); q.delete('user');
  const url = `${location.origin}${location.pathname}?${q}`;
  try { await navigator.clipboard.writeText(url); toast(`Invite link copied: ${url}`); }
  catch { toast(`Invite link: ${url}`, { ms: 15000 }); }
}
const newSession = () => { const q = new URLSearchParams(location.search); q.set('room', newRoom()); window.open('?' + q, '_blank'); };

export default function Header() {
  const key = hasKey();
  const reset = async () => {
    if (await ask('Clears the shared notebook in every open window and restores the Titanic scenario. This cannot be undone.', { title: 'Reset the demo?', ok: 'Reset notebook' })) resetDemo();
  };
  return <header>
    <img className="logo" src="../favicon.svg" alt="" width="28" height="28" />
    <h1 className="brand">CoPrompt <small>revibe · CHI ’24</small></h1>
    <span id="me"><Avatar u={ME} />You are {ME}</span>
    <span className="grow" />
    <span id="conn" data-s={ui.conn} title={CONN_TIP[ui.conn]}>{CONN[ui.conn]}{ROOM !== 'default' && ` · ${ROOM}`}</span>
    <span id="pystat" data-s={ui.py.s}>{ui.py.text}</span>
    <button id="other" onClick={() => window.open(otherUrl(), OTHER, 'width=1100,height=900')}><Icon name="external" />Open as {OTHER}</button>
    <button id="invite" onClick={invite} title="Copy a link to this session for others to join"><Icon name="share" />Invite</button>
    <button id="newsession" onClick={newSession} title="Open a new, empty session in a new tab"><Icon name="plus" />New session</button>
    <button id="settings" className={key ? undefined : 'needs'} onClick={openSettings}><Icon name="key" />{key ? 'API key' : 'Add API key'}</button>
    <button id="reset" onClick={reset}><Icon name="reset" />Reset demo</button>
  </header>;
}
