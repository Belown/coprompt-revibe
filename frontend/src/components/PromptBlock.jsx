// Prompt block + execution code block (§6.1), with explanation / history / comment panels.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import PromptInput from './PromptInput.jsx';
import { Avatar, Dots, Ctl, Grip, Presence } from './bits.jsx';
import ExplainPanel from './panels/ExplainPanel.jsx';
import HistoryPanel from './panels/HistoryPanel.jsx';
import CommentsPanel from './panels/CommentsPanel.jsx';
import { S, ui, presence, unseen, markSeen } from '../lib/store.js';
import { ME, MECH, ucol } from '../lib/util.js';
import { actsOn, text } from '../lib/model.js';
import { generate, promptFromCode } from '../lib/codegen.js';
import { commitCode, setSource } from '../lib/mechanisms.js';
import { run, clearOutput } from '../lib/python.js';
import { commitPrompt, flash } from '../lib/promptDom.js';
import { toast } from '../lib/ui.js';

function CodeArea({ b }) { // uncontrolled: a collaborator's update never overwrites code you are editing
  const ref = useRef(null);
  useLayoutEffect(() => {
    const ta = ref.current;
    if ((document.activeElement !== ta || ta.value === ta.dataset.orig) && ta.value !== b.code) { ta.value = b.code; ta.dataset.orig = b.code; }
  });
  return <textarea ref={ref} className="code" spellCheck={false} placeholder="# code appears here (you can also write it yourself)"
    rows={Math.max(2, Math.min(18, b.code.split('\n').length))} defaultValue={b.code}
    onFocus={e => { e.target.dataset.orig = e.target.value; presence(b.id); }}
    onBlur={e => { presence(null); if (e.target.value !== e.target.dataset.orig) { S.blocks[b.id].editor = ME; commitCode(b.id, e.target.value, 'edit code'); } }} />;
}

function Output({ o }) {
  return <div className="out">{o && <>{o.text}{o.err && <span className="err">{o.err}</span>}{o.img && <img alt="plot output" src={'data:image/png;base64,' + o.img} />}</>}</div>;
}

export default function PromptBlock({ b, dnd, rail }) {
  const id = b.id, ref = useRef(null), [panel, setPanel] = useState(null), [armed, arm] = useState(false);
  const others = Object.entries(ui.PRES).filter(([u, x]) => x === id && u !== ME).map(([u]) => u);
  const last = b.hist?.at(-1), isNew = unseen(b), busy = ui.BUSY[id], hasCode = !!b.code.trim();
  // signature moment: a block rewritten by a mechanism ripples in that mechanism's colour
  const seenTs = useRef(last?.ts ?? null);
  useEffect(() => {
    if (last && seenTs.current !== last.ts && MECH[last.action]) flash(ref.current, MECH[last.action].c);
    seenTs.current = last?.ts ?? null;
  });
  useEffect(() => { // focus a block that was just added
    if (ui.focus?.id !== id) return;
    ref.current.querySelector(ui.focus.part === 'code' ? 'textarea' : '.prompt')?.focus(); ui.focus = null;
  });
  const toggle = k => setPanel(p => p === k ? null : k);
  const cls = ['block', 'pb', others.length && 'here', ui.SOURCE?.b === id && !ui.SOURCE.n && 'is-src', isNew && 'unseen',
    dnd.dragging === id && 'dragging', dnd.drop?.id === id && (dnd.drop.after ? 'drop-after' : 'drop-before')].filter(Boolean).join(' ');
  return <div ref={ref} className={cls} data-id={id} style={{ '--who': ucol(others[0]), ...rail }}
    draggable={armed} onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); dnd.start(id); }}
    onDragEnd={() => { arm(false); dnd.end(); }} onClick={() => markSeen(id)} onFocus={() => markSeen(id)}>
    <span className="newtag" title="Changed by someone else or automatically. Click the block to dismiss.">
      {isNew ? (MECH[last.action] ? `Auto-updated · ${last.action}` : `Updated by ${last.by} · ${last.action}`) : ''}</span>
    <div className="phead">
      <Grip arm={arm} />
      <Avatar u={b.editor || b.author} title={`created by ${b.author}, last modified by ${b.editor || b.author}`} />
      <PromptInput b={b} />
      <Dots types={[...new Set(actsOn(id).map(a => a.type))]} />
      <span className="tools">
        <button title="Use the whole prompt as the source node" aria-label="Use whole prompt as source" onClick={() => setSource(id)}><Icon name="node" /></button>
        <button title="Explain (prompt ↔ code)" aria-label="Explain" onClick={() => hasCode || panel === 'explain' ? toggle('explain') : toast('Generate code first.')}><Icon name="bulb" /></button>
        <button title="History" aria-label="History" onClick={() => toggle('history')}><Icon name="history" /></button>
        <button title="Comments" aria-label="Comments" onClick={() => toggle('notes')}><Icon name="comment" /><span className="ncount">{b.notes?.length || ''}</span></button>
      </span>
    </div>
    <div className="busy">{busy && <><Icon name="loader" />{busy}</>}</div>
    <Presence users={others} />
    <CodeArea b={b} />
    <div className="runbar">
      <button className="gen" disabled={!!busy} title="Generate code from the prompt (Enter in the prompt)" onClick={() => { commitPrompt(id); generate(id); }}>
        <Icon name="sparkles" /><span className="gen-l">{hasCode ? 'Update code' : 'Generate code'}</span><kbd>Enter</kbd></button>
      <button className="p2c" disabled={!!busy} hidden={!!text(b).trim()} title="Code-first: write the prompt from this code and its comments"
        onClick={() => promptFromCode(id, ref.current.querySelector('textarea').value)}><Icon name="sparkles" />Prompt from code</button>
      <button className="run" disabled={!!busy} onClick={() => run(id)}><Icon name="play" />Run</button>
      <button className="rst" disabled={!b.out} title="Clear the output" onClick={() => clearOutput(id)}>Reset</button>
      <span className="grow" />
      <Ctl id={id} />
    </div>
    <Output o={b.out} />
    <div className="panel">
      {panel === 'explain' && <ExplainPanel b={b} onClose={() => setPanel(null)} />}
      {panel === 'history' && <HistoryPanel b={b} onClose={() => setPanel(null)} />}
      {panel === 'notes' && <CommentsPanel b={b} onClose={() => setPanel(null)} />}
    </div>
  </div>;
}
