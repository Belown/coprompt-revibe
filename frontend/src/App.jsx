import { useEffect, useSyncExternalStore } from 'react';
import Header from './components/Header.jsx';
import Editor from './components/Editor.jsx';
import Wiki from './components/Wiki.jsx';
import Messages from './components/Messages.jsx';
import { Modal, Toasts, MakeNode } from './components/Overlays.jsx';
import { subscribe, getVersion, emit } from './lib/bus.js';
import { S, ui, put, presence, unseen } from './lib/store.js';
import { ME } from './lib/util.js';
import { ordered, text, label, members } from './lib/model.js';
import { T } from './lib/templates.js';
import { mech, setSource, commitCode, checkShares, unlinkAt } from './lib/mechanisms.js';
import { generate, promptFromCode } from './lib/codegen.js';
import { addBlock, moveBlock, setPromptText, indent } from './lib/blocks.js';
import { run, pyRun } from './lib/python.js';
import { commitPrompt, jump } from './lib/promptDom.js';
import { toast, onModalClosed, isModalOpen } from './lib/ui.js';

// the whole app re-renders on every change; library modules hold the state (see lib/bus.js)
const useStore = () => useSyncExternalStore(subscribe, getVersion);

// test hook for e2e.mjs (drives the app through the same functions the UI calls)
window.cp = { get S() { return S; }, ui, put, ordered, text, label, members, T, mech, setSource, commitCode, generate, promptFromCode,
  addBlock, moveBlock, setPromptText, indent, run, pyRun, commitPrompt, jump };

onModalClosed(checkShares);

export default function App() {
  useStore();
  useEffect(() => { checkShares(); }); // share pop-ups, including those that arrived while this user was offline
  useEffect(() => {
    document.title = `CoPrompt · ${ME}`;
    const onKey = e => { if (e.key === 'Escape' && ui.SOURCE && !isModalOpen()) { ui.SOURCE = ui.TGTNODE = null; emit(); } };
    const onUnlink = e => { // click a link dot (on a node, a prompt or a heading) to unlink
      const d = e.target.closest?.('[data-unlink]'); if (!d) return;
      e.stopPropagation(); e.preventDefault();
      const host = d.closest('[data-id],[data-bid]');
      unlinkAt(host.dataset.id || host.dataset.bid, d.closest('.node')?.dataset.n);
    };
    const onLeave = () => presence(null);
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onUnlink, true);
    window.addEventListener('beforeunload', onLeave);
    const away = ordered().filter(unseen).length; // asynchronous case (§5): what changed while this user was offline
    if (away) toast(`${away} block${away > 1 ? 's' : ''} changed while you were away; they are highlighted. Click one to dismiss.`, { ms: 9000 });
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('click', onUnlink, true); window.removeEventListener('beforeunload', onLeave); };
  }, []);
  return <>
    <Header />
    <main>
      <Editor />
      <aside><Wiki /><Messages /></aside>
    </main>
    <MakeNode />
    <Modal />
    <Toasts />
  </>;
}
