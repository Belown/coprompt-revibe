// Two-window end-to-end check of the CoPrompt revibe via CDP (LLM stubbed).
// Usage (in frontend/): npm run build && npm run preview   (serves frontend/dist on :8000; the app is at /app/), then: npm run e2e
// E2E_BASE overrides the URL, e.g. E2E_BASE=http://localhost:8080/app/ against the docker compose stack.
import { spawn } from 'node:child_process';
const EDGE = process.env.E2E_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = process.env.E2E_BASE || 'http://localhost:8000/app/';
const ROOM = '&room=e2e' + Date.now(); // a fresh notebook per run (also on the sync backend, when one is running)
// no native occlusion detection: on an idle machine it stops all rendering (see tests/demo-e2e.mjs)
// a throwaway browser profile (~0.5 GB with Pyodide cached), deleted when the run ends
const PROFILE = `${process.env.TEMP || '/tmp'}/cp_e2e_${Date.now()}`;
const cleanup = async () => { proc.kill(); for (let i = 0; i < 20; i++) { try { (await import('node:fs')).rmSync(PROFILE, { recursive: true, force: true }); return; } catch { await new Promise(r => setTimeout(r, 500)); } } };
const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--remote-debugging-port=9333',
  `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ok = true, nPass = 0, nAll = 0;
const check = (c, m) => { nAll++; if (c) nPass++; console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };

async function page(url) {
  for (let i = 0; i < 50; i++) { try { await fetch('http://localhost:9333/json/version'); break; } catch { await sleep(200); } }
  const t = await (await fetch(`http://localhost:9333/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let n = 0; const pend = {};
  ws.onmessage = e => { const d = JSON.parse(e.data); if (pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
  const send = (method, params) => new Promise(r => { const id = ++n; pend[id] = r; ws.send(JSON.stringify({ id, method, params })); });
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
    return r.result?.result?.value;
  };
  return { ev, kill: async () => { ws.close(); await fetch(`http://localhost:9333/json/close/${t.id}`); } };
}

// Stubbed LLM, injected into each page. Batched inputs (link, request) are read from the JSON after the last "Input:\n".
function stubLLM() {
  window.__n = {}; window.__last = {}; window.__all = {}; window.__calls = 0;
  window.__llmStub = async (u) => {
    const kind = u.includes('[ADD]') ? 'add' : u.includes('AI Python code editor') ? 'edit' : u.includes('code dependencies') ? 'link'
      : u.includes('fulfills specific user requests') ? 'request' : u.includes('[$NODE]') ? 'regen' : u.includes('code-first') ? 'describe'
      : u.includes('step by step') ? 'explain' : '?';
    window.__calls++; __n[kind] = (__n[kind] || 0) + 1; __last[kind] = u; (__all[kind] ||= []).push(u);
    const p = (u.match(/\[\$PROMPT\]: (.*)/) || [])[1] || '', input = () => JSON.parse(u.slice(u.lastIndexOf('Input:\n') + 7));
    if (kind === 'add') return p.includes('missing') ? "df = df.drop(columns=['Cabin'])\ndf['Age'] = df['Age'].fillna(df['Age'].median())\nprint(df.isna().sum().sum())" : "df_encoded = pd.get_dummies(df, columns=['Sex','Embarked'])\nprint(df_encoded.shape)";
    if (kind === 'edit') return "df_encoded = pd.get_dummies(df, columns=['Sex'])\nprint(df_encoded.shape)";
    if (kind === 'link') return input().map(x => ({ id: x.id, index: x.index, reasoning: 'stub', updated: true, updated_code: 'print(df_encoded.skew(numeric_only=True))', updated_phrase: 'df_encoded' }));
    if (kind === 'request') return input().requests.map(x => ({ id: x.id, index: x.index, reasoning: 'stub', fulfilled: true }));
    if (kind === 'regen') { const m = u.match(/nodes marked as \[\[k\|text\]\]: (.*)/);
      return { prompt: m && m[1].replace(/\[\[0\|[^\]]*\]\]/, '[[0|df_encoded]]').replace('of all features', 'of all encoded features'), node_text: 'df_encoded', code: 'print(df_encoded.skew(numeric_only=True).round(2))' }; }
    if (kind === 'describe') return { prompt: 'print the mean age per passenger class in df' };
    if (kind === 'explain') return { steps: [{ phrase: 'encode', lines: [1], explanation: 'one-hot' }] };
    throw new Error('unexpected prompt');
  };
}
// helpers evaluated in-page (the app exposes its functions as window.cp)
function helpers() {
  for (const k of Object.keys(cp)) if (k !== 'S') window[k] = cp[k];
  Object.defineProperty(window, 'S', { get: () => cp.S, configurable: true });
  Object.defineProperty(window, 'SOURCE', { get: () => cp.ui.SOURCE, set: v => { cp.ui.SOURCE = v; }, configurable: true });
  window.el = id => document.querySelector('#editor [data-id="' + id + '"]');
  window.byText = t => ordered().find(b => text(b).includes(t));
  window.hid = t => ordered().find(b => b.kind === 'h' && b.text.startsWith(t)).id;
  window.acts = (t, f = () => true) => Object.values(S.actions).filter(a => a.type === t && f(a));
  window.nHist = (id, act) => (S.blocks[id].hist || []).filter(h => h.action === act).length;
  window.until = async (f, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await new Promise(r => setTimeout(r, 100)); } return false; };
  window.tick = () => new Promise(r => setTimeout(r, 50));
  window.newPrompt = async (afterText, t) => { const id = addBlock('p', byText(afterText).id); setPromptText(id, t); await generate(id); return id; };
  window.makeNode = async (id, word) => { await until(() => nodeFromWord(id, word)); const e = editorOf(id); e.commands.blur(); e.view.dom.dispatchEvent(new FocusEvent('blur')); return SOURCE; };
  window.clickOK = (v = 'fill missing values instead of dropping the columns') => {
    const b = document.querySelector('#modal .primary'); if (!b) return false;
    const i = document.querySelector('#modal input'); if (i) i.value = v; b.click(); return true;
  };
}
const INJECT = `(${stubLLM})(); (${helpers})(); 1`;

try {
  const A = await page(BASE + '?user=Alice' + ROOM); await sleep(1500);
  let B = await page(BASE + '?user=Bob' + ROOM); await sleep(1500);
  for (const P of [A, B]) await P.ev(INJECT);

  // 0. tasks start free; each person takes theirs by clicking the avatar on the heading (the paper's split)
  const take = (P, ts) => P.ev(`(async () => { for (const t of ${JSON.stringify(ts)}) { await until(() => el(hid(t))); el(hid(t)).querySelector('.as').click(); } return 1; })()`);
  check(await A.ev(`until(() => el(hid('Feature Analysis'))?.querySelector('.as.free')) && ordered().every(b => !b.author)`), 'a new notebook has no owners: every task is free');
  await take(A, ['Data Preparation']);
  check(await A.ev(`until(() => el(hid('1. Deal')).querySelector('.as.via') && el(hid('Feature Analysis')).querySelector('.as.free'))`), 'a task inside a taken section comes with it; the section’s sibling stays free');
  await take(A, ['Titanic', '1. Deal', '2. Encode', '5. Deal']); await take(B, ['Feature Analysis', '3. Feature', '4. Correlation']);
  check(await B.ev(`until(() => ['Titanic', 'Data Preparation', '1. Deal', '2. Encode', '5. Deal'].every(t => S.blocks[hid(t)].author === 'Alice')
    && ['Feature Analysis', '3. Feature', '4. Correlation'].every(t => S.blocks[hid(t)].author === 'Bob')
    && el(byText('load data').id).querySelector('.phead .av').textContent === 'A')`), 'each takes their tasks (synced); a starting prompt belongs to whoever took its task');

  // 1. Python execution of the seeded block
  // Pyodide comes from a CDN; if it cannot load, say so instead of hanging on run()
  const py = await A.ev(`(async()=>{ await until(() => cp.ui.py.s !== 'load', 150000); return cp.ui.py; })()`);
  if (py.s !== 'ok') throw new Error('Python did not load (CDN unreachable?): ' + py.text);
  check(await A.ev(`(async()=>{ await run(byText('load data').id); return S.blocks[byText('load data').id].out.text.includes('PassengerId'); })()`), 'Pyodide (Web Worker) runs seeded block (df.head())');
  await A.ev(`window.__busy = pyRun(['import time\\nt = time.time()\\nwhile time.time() - t < 3: pass']); 1`);
  const t0 = Date.now(); await A.ev('1 + 1'); const dt = Date.now() - t0;
  check(dt < 1000, `page answers within ${dt} ms while Python busy-loops for 3 s`);
  // run cache: an unchanged prefix is reused, the block itself always re-runs from the state before it,
  // and a block that defines a function turns caching off from there (a copy would point at the old namespace)
  check(await A.ev(`(async()=>{ await __busy; const a = await pyRun(['x = 1', 'x = x + 1', 'print(x)']), b = await pyRun(['x = 1', 'x = x + 1', 'print(x)']),
    c = await pyRun(['x = 1', 'x = x + 1', 'y = x * 10', 'print(y)']);
    return JSON.stringify([a.res.reused, a.res.text, b.res.reused, b.res.text, c.res.reused, c.res.text]); })()`) === JSON.stringify([0, '2\n', 2, '2\n', 2, '20\n']),
    'run cache: reuses the unchanged blocks above, never applies a block twice');
  check(await A.ev(`(async()=>{ const a = await pyRun(['def f(): return z', 'z = 1', 'print(f())']), b = await pyRun(['def f(): return z', 'z = 5', 'print(f())']);
    return JSON.stringify([b.res.reused, b.res.text]); })()`) === JSON.stringify([0, '5\n']), 'run cache: a block defining a function is not cached (stays correct)');
  await A.ev('__busy.then(() => 1)');
  check(await B.ev(`until(() => S.blocks[byText('load data').id].out?.text.includes('PassengerId'))`), 'execution output synced to Bob');

  // 2. Alice adds prompts; code generated; Bob sees it
  await A.ev(`newPrompt('1. Deal with missing', 'drop columns with missing values in df')`);
  check(await B.ev(`until(() => byText('drop columns')?.code.includes('fillna'))`), 'new prompt + generated code synced to Bob');
  const encId = await A.ev(`newPrompt('2. Encode', 'encode categorical features in df')`);
  check(await A.ev(`(async()=>{ await run('${encId}'); return S.blocks['${encId}'].out.text.includes('891'); })()`), 'run chains earlier blocks (fresh namespace)');

  // 3. Bob: refer — source node 'df' → Alice's encode prompt, with an optional note
  const bId = await B.ev(`newPrompt('3. Feature transformation', 'calculate the skewness of all features in df')`);
  await B.ev(`makeNode('${bId}', 'df')`);
  const refP = B.ev(`mech('refer', '${encId}', document.body)`);
  check(await B.ev(`until(() => clickOK('use the encoded frame'))`), 'refer asks for an optional note (gap 3)');
  await refP;
  check(await B.ev(`until(() => segs('${bId}').some(s => s.t==='node' && s.v==='df_encoded'))`), 'refer rewrites source node (df → df_encoded)');
  check(await B.ev(`text(S.blocks['${bId}']) === 'calculate the skewness of all encoded features in df_encoded'`), 'refer rewrites the whole prompt and keeps the node (Fig. 4c)');
  check(await B.ev(`acts('refer')[0].msg === 'use the encoded frame' && __last.regen.includes('[$MESSAGE]') && __last.regen.includes('use the encoded frame')`), 'refer note is stored and sent to the model');
  check(await A.ev(`until(() => acts('refer').length === 1)`), 'refer action appears in Alice’s message panel');

  // 4. Bob: request — Alice changes her encode prompt → fulfilment check → Bob's block regenerates
  const b2 = await B.ev(`newPrompt('4. Correlation', 'correlation matrix of df')`);
  await B.ev(`makeNode('${b2}', 'df')`);
  const reqP = B.ev(`mech('request', '${encId}', document.body)`);
  check(await B.ev(`until(() => clickOK())`), 'request dialog answered');
  await reqP;
  check(await A.ev(`until(() => acts('request', a => a.status === 'open').length === 1)`), 'request is pending for Alice');
  await A.ev(`(async()=>{ setPromptText('${encId}', 'encode only Sex in df'); await generate('${encId}'); })()`);
  check(await B.ev(`until(() => acts('request', a => a.status === 'fulfilled').length === 1 && S.blocks['${b2}'].code.includes('round(2)'))`), 'request fulfilled → requester block regenerated');

  // 5. Alice: link her missing-values node 'df' → Bob's skewness prompt; edit code → Bob's code updates
  await A.ev(`makeNode(byText('drop columns').id, 'df')`);
  const linkP = A.ev(`mech('link', '${bId}', document.body)`);
  check(await A.ev(`until(() => clickOK(''))`), 'link dialog (optional note) answered');
  await linkP;
  await A.ev(`commitCode(byText('drop columns').id, "df = df.dropna(subset=['Embarked'])", 'edit code')`);
  check(await B.ev(`until(() => nHist('${bId}', 'link') > 0)`), 'link propagates a code change to the linked block');
  check(await A.ev(`__last.link.includes('"previous_code"') && __last.link.includes('calculate_sum')`), 'link check gets previous code and the Fig. 14 few-shot example (gap 1)');

  // 6. Bob shares to Alice (with a note) → pop-up in Alice's window → accept → regenerate
  await B.ev(`makeNode('${b2}', 'matrix')`);
  const shareP = B.ev(`mech('share', byText('drop columns').id, document.body)`);
  check(await B.ev(`until(() => clickOK('matrix is ready'))`), 'share dialog (optional note) answered');
  await shareP;
  check(await A.ev(`(async()=>{ await until(() => document.querySelector('#modal')?.textContent.includes('Note from Bob')); document.querySelector('#modal').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); await tick(); return !!document.querySelector('#modal .dlg'); })()`), 'a click outside the share pop-up does not decline it');
  check(await A.ev(`until(() => document.querySelector('#modal')?.textContent.includes('Note from Bob: matrix is ready') && clickOK())`), 'share pop-up shows the note and is accepted');
  check(await A.ev(`until(() => acts('share', a => a.status === 'accepted').length === 1 && nHist(byText('drop columns').id, 'share') === 1)`), 'accepted share regenerates Alice’s block');

  // 7. the remaining gaps
  check(await A.ev(`T.request({}).includes('load_iris') && T.request({}).includes('reasoning') && T.link([]).includes('calculate_sum')`), 'request/link templates carry the Fig. 14–15 few-shot examples (gap 1)');
  check(await A.ev(`__last.request.includes('"completion"')`), 'request check input has the completion context of Fig. 15');
  // gap 2 + batching: a second request on the same block; one change → ONE batched request call; the fulfilled request fires again
  await B.ev(`(()=>{ SOURCE = { b: '${bId}', n: segs('${bId}').find(s => s.t==='node').id }; return 1; })()`);
  const req2 = B.ev(`mech('request', '${encId}', document.body)`);
  await B.ev(`until(() => clickOK('skewness on encoded data'))`); await req2;
  await A.ev(`until(() => acts('request').length === 2)`);
  const n0 = await A.ev(`__n.request`), h0 = await A.ev(`nHist('${b2}', 'request')`);
  await A.ev(`commitCode('${encId}', "df_encoded = pd.get_dummies(df)\\nprint(df_encoded.shape)", 'edit code')`);
  check(await A.ev(`__n.request`) - n0 === 1, 'two requests on one block are checked in ONE batched call (Fig. 15 takes a list)');
  check(await B.ev(`until(() => nHist('${b2}', 'request') > ${h0} && acts('request').every(a => a.status === 'fulfilled'))`), 'a fulfilled request regenerates again on a later change (gap 2, Fig. 5c)');
  check(await A.ev(`until(() => [...document.querySelectorAll('#toast button')].some(b => b.textContent === 'Undo'))`), 'an automatic rewrite’s toast offers Undo');
  // the unseen highlight: Bob's block was rewritten from Alice's window → highlighted for Bob until he clicks it
  check(await B.ev(`until(() => el('${bId}').classList.contains('unseen') && el('${bId}').querySelector('.newtag').textContent.includes('Auto-updated'))`), 'automatic change to Bob’s block is highlighted for Bob');
  check(await B.ev(`(async()=>{ el('${bId}').querySelector('.nt-act').click(); return until(() => el('${bId}').querySelector('.panel').textContent.length > 0 && !el('${bId}').classList.contains('unseen')); })()`), 'Review on the highlight opens the block’s history');
  check(await B.ev(`(async()=>{ el('${bId}').click(); return until(() => !el('${bId}').classList.contains('unseen')); })()`), 'clicking the block dismisses the highlight');
  await B.ev(`(()=>{ [...document.querySelectorAll('#msgs .msg')].find(m => m.textContent.includes('skewness on encoded data')).querySelector('button[title="Stop checking this request"]').click(); return 1; })()`);
  check(await A.ev(`until(() => acts('request', a => a.src.b === '${bId}')[0].status === 'closed')`), 'requester can stop tracking a request');
  // gap 4: Bob links his whole section 3 to Alice's section 2 (heading ↔ heading)
  await B.ev(`setSource(hid('3. Feature'))`);
  check(await B.ev(`until(() => { const p = [...document.querySelectorAll('#wiki .wh .pill')].map(x => x.textContent); return p.includes('link') && !p.includes('refer'); })`), 'section source offers share/link on headings (gap 4)');
  const hl = B.ev(`mech('link', hid('2. Encode'), document.body)`); await B.ev(`until(() => clickOK('same data'))`); await hl;
  await A.ev(`until(() => acts('link').some(a => a.tgt.b === hid('2. Encode')))`); // through a real server the link takes a moment to reach Alice
  const l0 = await B.ev(`nHist('${bId}', 'link')`);
  await A.ev(`commitCode('${encId}', "df_encoded = pd.get_dummies(df, drop_first=True)\\nprint(df_encoded.shape)", 'edit code')`);
  check(await B.ev(`until(() => nHist('${bId}', 'link') > ${l0})`), 'a change in section 2 reaches section 3 through the heading link');
  check(await A.ev(`__all.link.some(u => u.includes('whole section') && u.includes('same data'))`), 'heading link sends section scope and note to the link check');
  // unlink by clicking the link dot on the heading row in the wiki
  await A.ev(`(async()=>{ await until(() => document.querySelector('#wiki [data-bid="' + hid('2. Encode') + '"] i[data-unlink]')); document.querySelector('#wiki [data-bid="' + hid('2. Encode') + '"] i[data-unlink]').click(); return 1; })()`);
  check(await A.ev(`(async()=> await until(() => clickOK()) && await until(() => acts('link', a => S.blocks[a.src.b].kind === 'h')[0].status === 'unlinked'))()`), 'clicking the link icon unlinks (§5 “de-highlighting the link icon”)');
  // gap 7 + whole prompt as source: Bob shares his whole correlation prompt to Alice's task 5; Alice adds then edits a block there
  await B.ev(`setSource('${b2}')`);
  check(await B.ev(`until(() => el('${b2}').classList.contains('is-src') && SOURCE.n === null)`), 'whole prompt can be the source node');
  const sh2 = B.ev(`mech('share', hid('5. Deal'), document.body)`); await B.ev(`until(() => clickOK(''))`); await sh2;
  check(await A.ev(`until(() => clickOK())`), 'share to a heading is accepted');
  await A.ev(`until(() => (S.blocks[hid('5. Deal')].ctx || []).length > 0)`);
  const fId = await A.ev(`newPrompt('5. Deal with outliers', 'remove rows with Fare above 500')`);
  check(await A.ev(`__last.add.includes('shared with this task')`), 'shared task context reaches a NEW prompt (add)');
  await A.ev(`(async()=>{ setPromptText('${fId}', 'remove rows with Fare above 300'); await generate('${fId}'); })()`);
  check(await A.ev(`__last.edit.includes('shared with this task') && __last.edit.includes('correlation')`), 'shared task context reaches an EDITED prompt too (gap 7)');
  // gap 5: code-first block → prompt written from the comments
  const cId = await A.ev(`addBlock('p', byText('drop columns').id)`);
  check(await A.ev(`until(() => document.activeElement === el('${cId}')?.querySelector('.prompt') && !el('${cId}').querySelector('.p2c').hidden)`), 'a new block focuses its prompt and, while it is empty, offers “Prompt from code”');
  await A.ev(`(async()=>{ S.blocks['${cId}'].code = "# mean age per passenger class\\nprint(df.groupby('Pclass')['Age'].mean())"; await tick(); el('${cId}').querySelector('.p2c').click(); return until(() => text(S.blocks['${cId}'])); })()`);
  check(await B.ev(`until(() => text(S.blocks['${cId}']) === 'print the mean age per passenger class in df' && S.blocks['${cId}'].code.includes('groupby'))`), 'prompt generated from code comments, synced (gap 5)');
  check(await A.ev(`until(() => el('${cId}').querySelector('.p2c').hidden && S.blocks['${cId}'].hist.at(-1).action === 'prompt from code')`), 'prompt-from-code is versioned; the button hides once a prompt exists');
  // gap 6: comments
  await A.ev(`(async()=>{ el('${bId}').querySelector('[aria-label=Comments]').click(); await until(() => el('${bId}').querySelector('.nform input'));
    el('${bId}').querySelector('.nform input').value = 'why log1p here?'; el('${bId}').querySelector('.nform button').click(); return 1; })()`);
  check(await B.ev(`until(() => S.blocks['${bId}'].notes?.length === 1 && el('${bId}').querySelector('.ncount').textContent === '1' && document.querySelector('#toast').textContent.includes('why log1p'))`), 'comment syncs to Bob with count badge and notification (gap 6)');
  check(await B.ev(`(async()=>{ el('${bId}').querySelector('[aria-label=Comments]').click(); return until(() => el('${bId}').querySelector('.nlist')?.textContent.includes('why log1p here?')); })()`), 'comment thread renders');
  // prompt edits without regeneration are versioned
  await A.ev(`(async()=>{ await until(() => editorOf('${fId}')); const e = editorOf('${fId}'); e.view.focus(); e.commands.setContent('<p>remove rows with Fare above 250</p>'); e.commands.blur(); e.view.dom.dispatchEvent(new FocusEvent('blur')); return 1; })()`);
  check(await A.ev(`until(() => S.blocks['${fId}'].hist.at(-1).action === 'edit prompt text' && text(S.blocks['${fId}']) === 'remove rows with Fare above 250')`), 'a prompt edit without regeneration becomes a history version');
  // small UI pieces: jump to node, Reset output, reorder
  check(await A.ev(`(()=>{ const n = segs('${bId}').find(s => s.t==='node').id; jump('${bId}', n); return el('${bId}').querySelector('.node[data-n="' + n + '"]').getAnimations().length > 0; })()`), 'jumping from a message pulses the node itself');
  await A.ev(`(()=>{ el(byText('load data').id).querySelector('.rst').click(); return 1; })()`);
  check(await B.ev(`until(() => S.blocks[byText('load data').id].out === null)`), 'Reset clears the output in both windows');
  await A.ev(`moveBlock('${cId}', byText('drop columns').id, false)`);
  check(await B.ev(`until(() => { const o = ordered().map(b => b.id); return o.indexOf('${cId}') === o.indexOf(byText('drop columns').id) - 1; })`), 'reordering moves the block (synced)');
  check(await A.ev(`document.querySelectorAll('#editor .grip').length === ordered().length`), 'every block has a drag handle');
  // outline: Shift+Tab / Tab move a heading and its subheadings together; no deeper than one below the heading above
  const lv = `['Feature Analysis','3. Feature','5. Deal'].map(t => S.blocks[hid(t)].level).join()`;
  await A.ev(`indent(hid('Feature Analysis'), -1)`);
  check(await B.ev(`until(() => ${lv} === '1,2,2' && getComputedStyle(el(hid('3. Feature'))).getPropertyValue('--d') === '1')`), 'outdent moves the section’s subheadings with it (synced, re-indented)');
  await A.ev(`indent(hid('Feature Analysis'), 1); indent(hid('Data Preparation'), 1)`);
  check(await A.ev(`${lv} === '2,3,3' && S.blocks[hid('Data Preparation')].level === 2`), 'indent restores it; indenting past the heading above is refused');
  // drag and drop as the browser sends it: dropping on a heading's title must move the block, not paste its id into the title
  const dragTo = (from, to) => `(() => { const dt = new DataTransfer(), r = ${to}.getBoundingClientRect(), o = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 30, clientY: r.bottom - 2 };
    ${from}.dispatchEvent(new DragEvent('dragstart', o)); return new Promise(res => setTimeout(() => { ${to}.dispatchEvent(new DragEvent('dragover', o));
    setTimeout(() => { ${to}.dispatchEvent(new DragEvent('drop', o)); ${from}.dispatchEvent(new DragEvent('dragend', o)); res(1); }, 50); }, 50)); })()`;
  await A.ev(dragTo(`el('${cId}')`, `el(hid('4. Correlation')).querySelector('.htext')`));
  check(await B.ev(`until(() => { const o = ordered().map(b => b.id); return o.indexOf('${cId}') === o.indexOf(hid('4. Correlation')) + 1; })`)
    && await A.ev(`S.blocks[hid('4. Correlation')].text === '4. Correlation analysis' && !document.querySelector('.drop-before, .drop-after, .dragging')`), 'dragging a block onto a heading title moves it and leaves the title alone');
  const order = `ordered().map(b => text(b).slice(0, 12)).join('|')`, before = await A.ev(order);
  const sec = await A.ev(`JSON.stringify([hid('Feature Analysis'), ...section(hid('Feature Analysis')).map(b => b.id)])`);
  await A.ev(`moveBlock(hid('Feature Analysis'), hid('Data Preparation'), false)`);
  check(await A.ev(`(() => { const o = ordered().map(b => b.id), f = o.indexOf(hid('Feature Analysis')), s = ${sec};
    return f < o.indexOf(hid('Data Preparation')) && JSON.stringify(o.slice(f, f + s.length)) === JSON.stringify(s); })()`), 'a heading moves with its whole section');
  await A.ev(`moveBlock(hid('Data Preparation'), hid('Feature Analysis'), false); moveBlock(hid('Feature Analysis'), hid('4. Correlation'), true)`);
  check(await A.ev(`${order} === ${JSON.stringify(before)}`), 'moving it back restores the order; dropping a heading inside its own section is refused');
  // wiki: grip on the left, fold on the right, rows drag like blocks
  check(await A.ev(`(() => { const r = document.querySelector('#wiki [data-bid="' + hid('Feature Analysis') + '"]'); return r.firstElementChild.classList.contains('grip') && r.lastElementChild.classList.contains('fold') && r.querySelector('.hl').textContent === 'H2'; })()`), 'wiki heading rows: grip left, H-level, fold toggle right');
  const wrow = id => `document.querySelector('#wiki [data-bid="' + ${id} + '"]')`;
  await A.ev(dragTo(wrow(`'${cId}'`), wrow(`hid('5. Deal')`)));
  check(await B.ev(`until(() => { const o = ordered().map(b => b.id); return o.indexOf('${cId}') === o.indexOf(hid('5. Deal')) + 1; })`), 'dragging a wiki row reorders the notebook');
  // H1/H2/H3 chip cycles through the allowed levels
  check(await A.ev(`el(hid('Data Preparation')).querySelector('.lvl').textContent === 'H2'`), 'headings show their level');
  await A.ev(`el(hid('5. Deal')).querySelector('.lvl').click()`);
  check(await A.ev(`until(() => S.blocks[hid('5. Deal')].level === 4 && el(hid('5. Deal')).querySelector('.lvl').textContent === 'H4')`), 'the level chip moves a heading in a level');
  await A.ev(`el(hid('5. Deal')).querySelector('.lvl').click()`);
  check(await A.ev(`until(() => S.blocks[hid('5. Deal')].level === 1)`), 'the level chip goes back out to H1 when it cannot go deeper');
  await A.ev(`indent(hid('5. Deal'), 1); indent(hid('5. Deal'), 1); 1`);
  // giving a task up: it falls back to the section around it (Bob's) until Bob takes it himself; then Alice takes it back
  await A.ev(`el(hid('5. Deal')).querySelector('.as').click()`);
  check(await B.ev(`until(() => S.blocks[hid('5. Deal')].level === 3 && S.blocks[hid('5. Deal')].author === null && el(hid('5. Deal')).querySelector('.as.via .av').textContent === 'B')`), 'a task given up shows the section’s owner, faded (synced)');
  await B.ev(`el(hid('5. Deal')).querySelector('.as').click()`);
  check(await A.ev(`until(() => S.blocks[hid('5. Deal')].author === 'Bob')`), 'someone else can take it');
  await B.ev(`el(hid('5. Deal')).querySelector('.as').click()`); await A.ev(`until(() => S.blocks[hid('5. Deal')].author === null)`);
  await A.ev(`el(hid('5. Deal')).querySelector('.as').click()`);
  check(await B.ev(`until(() => S.blocks[hid('5. Deal')].author === 'Alice')`), 'and the first one can take it back once it is free');
  // picking: rows inside (or around) the source section get no pills; the rest only share/link
  await A.ev(`setSource(hid('Data Preparation'))`);
  check(await A.ev(`until(() => { const pills = t => [...document.querySelector('#wiki [data-bid="' + hid(t) + '"]').querySelectorAll('.pill')].map(x => x.textContent).join();
    return pills('1. Deal') === '' && pills('Titanic') === '' && pills('Feature Analysis') === 'share,link' && document.querySelector('#wiki [data-bid="' + hid('2. Encode') + '"]').classList.contains('nope'); })`), 'only valid targets get pills; overlapping rows are greyed');
  await A.ev(`(() => { SOURCE = null; return 1; })()`);

  // 8. collaborative prompt text (Y.js, §6.3): two people typing in one prompt at once both keep their text,
  // and each sees the other's text cursor
  const dc = await A.ev(`byText('drop columns').id`);
  await B.ev(`(async()=>{ await until(() => editorOf('${dc}')); const e = editorOf('${dc}'); e.view.focus(); e.commands.setTextSelection(e.state.doc.content.size - 1); return 1; })()`);
  await Promise.all([
    A.ev(`(()=>{ const e = editorOf('${dc}'); e.view.focus(); e.commands.setTextSelection(1); e.commands.insertContent('please '); return 1; })()`),
    B.ev(`(()=>{ editorOf('${dc}').commands.insertContent(' and keep Age'); return 1; })()`),
  ]);
  const both = `until(() => text(S.blocks['${dc}']).startsWith('please ') && text(S.blocks['${dc}']).endsWith(' and keep Age'))`;
  check(await A.ev(both) && await B.ev(both), 'two people typing in one prompt at once: both edits are kept (Y.js)');
  check(await A.ev(`until(() => [...el('${dc}').querySelectorAll('.ccaret-l')].some(x => x.textContent === 'Bob'))`), 'Bob’s text cursor shows in Alice’s copy of the prompt');
  for (const P of [A, B]) await P.ev(`(()=>{ const e = editorOf('${dc}'); e.commands.blur(); e.view.dom.dispatchEvent(new FocusEvent('blur')); return 1; })()`);
  // code and heading titles are collaborative too: concurrent edits merge
  const lc = await A.ev(`byText('load data').id`);
  await Promise.all([
    A.ev(`(()=>{ const v = codeViewOf('${lc}'); v.dispatch({ changes: { from: 0, insert: '# by Alice\\n' } }); return 1; })()`),
    B.ev(`(()=>{ const v = codeViewOf('${lc}'); v.dispatch({ changes: { from: v.state.doc.length, insert: '\\n# by Bob' } }); return 1; })()`),
  ]);
  const bothCode = `until(() => { const c = S.blocks['${lc}'].code; return c.startsWith('# by Alice\\n') && c.endsWith('\\n# by Bob') && codeViewOf('${lc}').state.doc.toString() === c; })`;
  check(await A.ev(bothCode) && await B.ev(bothCode), 'two people editing one code block at once: both edits kept, in both editors');
  const h3 = await A.ev(`hid('3. Feature')`);
  await Promise.all([
    A.ev(`(()=>{ const e = editorOf('${h3}'); e.view.focus(); e.commands.setTextSelection(1); e.commands.insertContent('Step '); return 1; })()`),
    B.ev(`(()=>{ const e = editorOf('${h3}'); e.view.focus(); e.commands.setTextSelection(e.state.doc.content.size - 1); e.commands.insertContent(' (Bob)'); return 1; })()`),
  ]);
  const bothHead = `until(() => S.blocks['${h3}'].text === 'Step 3. Feature transformation (Bob)' && [...document.querySelectorAll('#wiki .wh .wtext')].some(x => x.textContent === 'Step 3. Feature transformation (Bob)'))`;
  check(await A.ev(bothHead) && await B.ev(bothHead), 'two people typing in one heading at once: both kept, and the wiki follows');
  for (const P of [A, B]) await P.ev(`(()=>{ const e = editorOf('${h3}'); e.commands.blur(); e.view.dom.dispatchEvent(new FocusEvent('blur')); return 1; })()`);
  await A.ev(`S.blocks['${h3}'].text = '3. Feature transformation'; 1`); // later steps find it by its title
  await A.ev(`(()=>{ const v = codeViewOf('${lc}'); v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: "import pandas as pd\\ndf = pd.read_csv('data/titanic.csv')\\ndf.head()" } }); return 1; })()`);
  // earlier bug fixes: trailing space trimmed; deleted blocks silence links
  const tId = await A.ev(`newPrompt('5. Deal with outliers', 'remove outliers of df using IQR')`);
  const sel = (w, n) => `const e = editorOf('${tId}'); let pos = -1; e.state.doc.descendants((x, p) => { if (x.isText && x.text.includes('${w}')) pos = p + x.text.indexOf('${w}'); }); e.view.focus(); e.commands.setTextSelection({ from: pos, to: pos + ${n} });`;
  check(await A.ev(`(async()=>{ await until(() => editorOf('${tId}') && text(S.blocks['${tId}']).includes('IQR')); ${sel('df', 3)}
    await until(() => document.querySelector('.bubble .mk')); document.querySelector('.bubble .mk').click(); return JSON.stringify(segs('${tId}').map(s => s.v)); })()`) === JSON.stringify(['remove outliers of ', 'df', ' using IQR']), 'selection "df " becomes node "df" (space kept outside), from the selection toolbar');
  await A.ev(`(async()=>{ ${sel('IQR', 3)} await until(() => document.querySelector('.bubble .fmt-bold')); document.querySelector('.bubble .fmt-bold').click(); const e2 = editorOf('${tId}'); e2.commands.blur(); e2.view.dom.dispatchEvent(new FocusEvent('blur')); return 1; })()`);
  check(await B.ev(`until(() => el('${tId}')?.querySelector('.prompt strong')?.textContent === 'IQR' && text(S.blocks['${tId}']) === 'remove outliers of df using IQR')`), 'bold from the toolbar syncs, and the prompt text the model sees is unchanged');
  await A.ev(`(() => { SOURCE = null; return 1; })()`);
  await A.ev(`(async()=>{ SOURCE = null; const l = acts('link')[0]; const b = S.blocks[l.tgt.b]; b.del = true; put('blocks', b); window.__c0 = __calls; await commitCode(l.src.b, 'df = df.dropna()', 'edit code'); })()`);
  check(await A.ev(`__calls === __c0`), 'link to a deleted block makes no LLM call');

  // 9. explain + history views render; wiki shows dots, message panel populated
  check(await A.ev(`(async()=>{ const id = '${encId}'; el(id).querySelector('[aria-label=Explain]').click(); return until(() => el(id).querySelector('.xcode mark, .xcode div[data-i]')); })()`), 'explain view renders');
  check(await A.ev(`(async()=>{ const id = byText('drop columns').id; el(id).querySelector('[aria-label=History]').click(); await until(() => el(id).querySelector('.hrow')); el(id).querySelector('.hrow').click(); return until(() => el(id).querySelector('.dcode')); })()`), 'history diff renders');
  check(await A.ev(`document.querySelectorAll('#wiki .dots i').length > 0 && document.querySelectorAll('#msgs .msg').length >= 6`), 'wiki dots + message panel populated');

  check(await A.ev(`(async()=>{ document.querySelector('#wikiCard .help').click(); await until(() => document.querySelector('#modal .mhelp'));
    const ok = [...document.querySelectorAll('#modal .mh-list dt')].map(d => d.textContent).join() === 'refer,request,share,link';
    document.querySelector('#modal .btns .primary').click(); await until(() => !document.querySelector('#modal .dlg')); return ok; })()`), 'the ? in the Prompt Wiki explains the four mechanisms');
  // invite: a pop-up with a QR code and the link (same session, no user) to copy
  check(await A.ev(`(async()=>{ document.querySelector('#invite').click(); await until(() => document.querySelector('#modal .qr'));
    const m = document.querySelector('#modal'), url = m.querySelector('.copyrow input').value, ok = m.querySelector('.qr').src.startsWith('data:image/svg+xml')
      && url.includes('room=') && !url.includes('user=') && !m.querySelector('.btns button:not(.primary)');
    m.querySelector('.btns .primary').click(); await until(() => !document.querySelector('#modal .dlg')); return ok; })()`), 'Invite opens a pop-up with a QR code and the session link (no ?user=), closed with Done');
  check(await A.ev(`(async()=>{ document.querySelector('#invite').click(); await until(() => document.querySelector('#modal .dlg'));
    const m = document.querySelector('#modal'); m.querySelector('.dlg').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); await tick();
    const kept = !!m.querySelector('.dlg'); m.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return kept && until(() => !document.querySelector('#modal .dlg')); })()`), 'a click inside a pop-up keeps it; a click outside closes it');
  // live cursors: opt-in on both sides; Alice's pointer over a block shows in Bob's window, and goes when she turns it off
  check(await B.ev(`!document.querySelector('.cursor')`), 'no live cursors until turned on');
  for (const P of [A, B]) await P.ev(`document.querySelector('#cursors').click(); 1`);
  await A.ev(`(async()=>{ await until(() => document.querySelector('#cursors').getAttribute('aria-pressed') === 'true'); const r = el('${encId}').getBoundingClientRect();
    el('${encId}').dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + 20, clientY: r.top + 10 })); return 1; })()`);
  check(await B.ev(`until(() => document.querySelector('.cursor span')?.textContent === 'Alice')`), 'Alice’s live cursor shows in Bob’s window');
  // anywhere on the page: Alice points at and clicks the API key button in the header
  await B.ev(`scrollTo(0, 0); 1`); // on a narrow window the header scrolls away, and a pointer on it has nowhere to show
  await A.ev(`(()=>{ const t = document.querySelector('#settings'), r = t.getBoundingClientRect(), o = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    t.dispatchEvent(new MouseEvent('mousemove', o)); t.dispatchEvent(new MouseEvent('mousedown', o)); return 1; })()`);
  check(await B.ev(`until(() => { const b = document.querySelector('.cursor-box'), s = document.querySelector('#settings').getBoundingClientRect(); if (!b || !document.querySelector('.cursor-click')) return false;
    const r = b.getBoundingClientRect(); return Math.abs(r.left + 3 - s.left) < 2 && Math.abs(r.width - 6 - s.width) < 2; })`), 'Alice’s pointer on the header’s API key button: Bob sees it boxed, and her click');
  await A.ev(`(()=>{ const t = document.querySelector('#settings'), r = t.getBoundingClientRect(); t.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })); t.click(); return 1; })()`); // a dialog only Alice sees
  check(await B.ev(`until(() => { const h = document.querySelector('.cursor-box.held'), t = document.querySelector('#settings').getBoundingClientRect(); if (!h || document.querySelector('.cursor')) return false;
    const r = h.getBoundingClientRect(); return h.querySelector('b').textContent === 'Alice' && Math.abs(r.left + 3 - t.left) < 2 && Math.abs(r.width - 6 - t.width) < 2; })`), 'Alice opens the API key dialog: Bob sees no arrow, the button stays boxed with her name');
  await A.ev(`(async()=>{ await until(() => document.querySelector('#modal .dlg')); document.querySelector('#modal .btns button').click();
    await until(() => !document.querySelector('#modal .dlg')); await new Promise(r => setTimeout(r, 200));
    const t = document.querySelector('#settings'), r = t.getBoundingClientRect(); t.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + 5, clientY: r.top + 5 })); return 1; })()`);
  check(await B.ev(`until(() => document.querySelector('.cursor span')?.textContent === 'Alice' && !document.querySelector('.cursor-box.held'))`), 'dialog closed: the box is released, her pointer is back on her next move');
  await A.ev(`(()=>{ const t = document.querySelector('#morebtn'), r = t.getBoundingClientRect(); t.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })); t.click(); return 1; })()`); // the ⋯ menu (a native popover)
  check(await B.ev(`until(() => { const h = document.querySelector('.cursor-box.held'), t = document.querySelector('#morebtn').getBoundingClientRect(); if (!h || document.querySelector('.cursor')) return false;
    const r = h.getBoundingClientRect(); return h.querySelector('b').textContent === 'Alice' && Math.abs(r.left + 3 - t.left) < 2 && Math.abs(r.width - 6 - t.width) < 2; })`) && await A.ev(`until(() => getComputedStyle(document.querySelector('#morebtn')).backgroundColor !== getComputedStyle(document.querySelector('#invite')).backgroundColor)`),
    'Alice opens the ⋯ menu: its button stays highlighted, for her and (boxed) for Bob');
  await A.ev(`document.querySelector('#more').hidePopover(); 1`);
  check(await B.ev(`until(() => !document.querySelector('.cursor-box.held'))`), 'menu closed: the box is released');
  await A.ev(`document.querySelector('#cursors').click(); 1`);
  check(await B.ev(`until(() => !document.querySelector('.cursor'))`), 'turning live cursors off removes the pointer for others');

  // 10. asynchronous case: Bob closes his window, Alice changes his block, Bob comes back → highlighted + notice
  await B.kill(); await sleep(500);
  await A.ev(`(async()=>{ const b = S.blocks['${b2}']; await commitCode('${b2}', b.code + '\\nprint(1)', 'edit code'); return 1; })()`);
  B = await page(BASE + '?user=Bob' + ROOM); await sleep(2000);
  await B.ev(INJECT);
  check(await B.ev(`until(() => el('${b2}')?.classList.contains('unseen') && el('${b2}').querySelector('.newtag').textContent === 'Updated by Alice · edit code')`), 'a change made while Bob was offline is highlighted when he returns');
  check(await B.ev(`until(() => document.querySelector('#toast').textContent.includes('while you were away'))`), 'Bob gets a “changed while you were away” notice');
  // topics: a new session from the join screen picks one; the notebook and its data follow it
  const W = await page(BASE.replace(/\?.*$/, '')); await sleep(1500);
  await W.ev(`(async()=>{ const until = async f => { for (let i = 0; i < 100 && !f(); i++) await new Promise(r => setTimeout(r, 100)); }; await until(() => document.querySelectorAll('.topics input').length);
    document.querySelector('input[name=user]').value = 'Wendy'; document.querySelector('.topics input[value=wine]').click(); document.querySelector('#join .primary').click(); return 1; })()`);
  await sleep(2500);
  check(await W.ev(`(async()=>{ for (let i = 0; i < 100 && !window.cp?.S; i++) await new Promise(r => setTimeout(r, 100));
    return location.search.includes('topic=wine') && cp.S.scenario === 'wine' && cp.text(cp.ordered()[0]).startsWith('Wine'); })()`), 'join screen: a new session with the Wine topic starts from its outline');
  check(await W.ev(`(async()=>{ for (let i = 0; i < 1500 && cp.ui.py.s === 'load'; i++) await new Promise(r => setTimeout(r, 100));
    const id = cp.ordered().find(b => b.kind === 'p').id; await cp.run(id); return cp.S.blocks[id].out?.text.includes('alcohol'); })()`), 'its load block runs: scikit-learn’s wine data in the browser');
  await W.kill();
  console.log('LLM calls (stubbed) in Alice:', await A.ev('__calls'));
  await A.kill(); await B.kill();
} catch (e) { ok = false; console.log('ERROR', e.message); }
console.log(`${nPass}/${nAll} passed`); console.log(ok ? 'ALL PASS' : 'SOME FAILED'); await cleanup(); process.exit(ok ? 0 : 1);
