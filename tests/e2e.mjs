// Two-window end-to-end check of the CoPrompt revibe via CDP (LLM stubbed).
// Usage (in frontend/): npm run build && npm run preview   (serves frontend/dist on :8000), then: npm run e2e
// E2E_BASE overrides the URL, e.g. E2E_BASE=http://localhost:8000/dist/ when a static server runs in frontend/.
import { spawn } from 'node:child_process';
const EDGE = process.env.E2E_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = process.env.E2E_BASE || 'http://localhost:8000/';
const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9333',
  `--user-data-dir=${process.env.TEMP || '/tmp'}/cp_e2e_${Date.now()}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ok = true, nPass = 0, nAll = 0;
const check = (c, m) => { nAll++; if (c) nPass++; console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };

async function page(url) {
  for (let i = 0; i < 50; i++) { try { await fetch('http://localhost:9333/json/version'); break; } catch { await sleep(200); } }
  const t = await (await fetch(`http://localhost:9333/json/new?${url}`, { method: 'PUT' })).json();
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
  window.makeNode = async (id, word) => {
    await until(() => el(id)?.querySelector('.prompt')?.textContent.includes(word));
    const p = el(id).querySelector('.prompt'); p.focus();
    const tn = [...p.childNodes].find(n => n.nodeType === 3 && n.textContent.includes(word)), i = tn.textContent.lastIndexOf(word);
    const r = document.createRange(); r.setStart(tn, i); r.setEnd(tn, i + word.length); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    document.querySelector('#mk').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); p.blur(); return SOURCE;
  };
  window.clickOK = (v = 'fill missing values instead of dropping the columns') => {
    const b = document.querySelector('#modal .primary'); if (!b) return false;
    const i = document.querySelector('#modal input'); if (i) i.value = v; b.click(); return true;
  };
}
const INJECT = `(${stubLLM})(); (${helpers})(); 1`;

try {
  const A = await page(BASE + '?user=Alice'); await sleep(1500);
  let B = await page(BASE + '?user=Bob'); await sleep(1500);
  for (const P of [A, B]) await P.ev(INJECT);

  // 1. Python execution of the seeded block
  // Pyodide comes from a CDN; if it cannot load, say so instead of hanging on run()
  const py = await A.ev(`(async()=>{ await until(() => cp.ui.py.s !== 'load', 150000); return cp.ui.py; })()`);
  if (py.s !== 'ok') throw new Error('Python did not load (CDN unreachable?): ' + py.text);
  check(await A.ev(`(async()=>{ await run(byText('load data').id); return S.blocks[byText('load data').id].out.text.includes('PassengerId'); })()`), 'Pyodide (Web Worker) runs seeded block (df.head())');
  await A.ev(`window.__busy = pyRun(['import time\\nt = time.time()\\nwhile time.time() - t < 3: pass']); 1`);
  const t0 = Date.now(); await A.ev('1 + 1'); const dt = Date.now() - t0;
  check(dt < 1000, `page answers within ${dt} ms while Python busy-loops for 3 s`);
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
  check(await B.ev(`until(() => S.blocks['${bId}'].segs.some(s => s.t==='node' && s.v==='df_encoded'))`), 'refer rewrites source node (df → df_encoded)');
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
  check(await A.ev(`until(() => document.querySelector('#modal')?.textContent.includes('Note from Bob: matrix is ready') && clickOK())`), 'share pop-up shows the note and is accepted');
  check(await A.ev(`until(() => acts('share', a => a.status === 'accepted').length === 1 && nHist(byText('drop columns').id, 'share') === 1)`), 'accepted share regenerates Alice’s block');

  // 7. the remaining gaps
  check(await A.ev(`T.request({}).includes('load_iris') && T.request({}).includes('reasoning') && T.link([]).includes('calculate_sum')`), 'request/link templates carry the Fig. 14–15 few-shot examples (gap 1)');
  check(await A.ev(`__last.request.includes('"completion"')`), 'request check input has the completion context of Fig. 15');
  // gap 2 + batching: a second request on the same block; one change → ONE batched request call; the fulfilled request fires again
  await B.ev(`(()=>{ SOURCE = { b: '${bId}', n: S.blocks['${bId}'].segs.find(s => s.t==='node').id }; return 1; })()`);
  const req2 = B.ev(`mech('request', '${encId}', document.body)`);
  await B.ev(`until(() => clickOK('skewness on encoded data'))`); await req2;
  await A.ev(`until(() => acts('request').length === 2)`);
  const n0 = await A.ev(`__n.request`), h0 = await A.ev(`nHist('${b2}', 'request')`);
  await A.ev(`commitCode('${encId}', "df_encoded = pd.get_dummies(df)\\nprint(df_encoded.shape)", 'edit code')`);
  check(await A.ev(`__n.request`) - n0 === 1, 'two requests on one block are checked in ONE batched call (Fig. 15 takes a list)');
  check(await B.ev(`until(() => nHist('${b2}', 'request') > ${h0} && acts('request').every(a => a.status === 'fulfilled'))`), 'a fulfilled request regenerates again on a later change (gap 2, Fig. 5c)');
  // the unseen highlight: Bob's block was rewritten from Alice's window → highlighted for Bob until he clicks it
  check(await B.ev(`until(() => el('${bId}').classList.contains('unseen') && el('${bId}').querySelector('.newtag').textContent.includes('Auto-updated'))`), 'automatic change to Bob’s block is highlighted for Bob');
  check(await B.ev(`(async()=>{ el('${bId}').click(); return until(() => !el('${bId}').classList.contains('unseen')); })()`), 'clicking the block dismisses the highlight');
  await B.ev(`(()=>{ [...document.querySelectorAll('#msgs .msg')].find(m => m.textContent.includes('skewness on encoded data')).querySelector('button[title="Stop checking this request"]').click(); return 1; })()`);
  check(await A.ev(`until(() => acts('request', a => a.src.b === '${bId}')[0].status === 'closed')`), 'requester can stop tracking a request');
  // gap 4: Bob links his whole section 3 to Alice's section 2 (heading ↔ heading)
  await B.ev(`setSource(hid('3. Feature'))`);
  check(await B.ev(`until(() => { const p = [...document.querySelectorAll('#wiki .wh .pill')].map(x => x.textContent); return p.includes('link') && !p.includes('refer'); })`), 'section source offers share/link on headings (gap 4)');
  const hl = B.ev(`mech('link', hid('2. Encode'), document.body)`); await B.ev(`until(() => clickOK('same data'))`); await hl;
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
  const cId = await A.ev(`addBlock('c', byText('drop columns').id)`);
  check(await A.ev(`until(() => document.activeElement === el('${cId}')?.querySelector('textarea') && !el('${cId}').querySelector('.p2c').hidden)`), 'code block focuses its code area and offers “Prompt from code”');
  await A.ev(`(async()=>{ const t = el('${cId}').querySelector('textarea'); t.value = "# mean age per passenger class\\nprint(df.groupby('Pclass')['Age'].mean())"; t.blur(); await tick(); el('${cId}').querySelector('.p2c').click(); return until(() => text(S.blocks['${cId}'])); })()`);
  check(await B.ev(`until(() => text(S.blocks['${cId}']) === 'print the mean age per passenger class in df' && S.blocks['${cId}'].code.includes('groupby'))`), 'prompt generated from code comments, synced (gap 5)');
  check(await A.ev(`until(() => el('${cId}').querySelector('.p2c').hidden && S.blocks['${cId}'].hist.at(-1).action === 'prompt from code')`), 'prompt-from-code is versioned; the button hides once a prompt exists');
  // gap 6: comments
  await A.ev(`(async()=>{ el('${bId}').querySelector('[aria-label=Comments]').click(); await until(() => el('${bId}').querySelector('.nform input'));
    el('${bId}').querySelector('.nform input').value = 'why log1p here?'; el('${bId}').querySelector('.nform button').click(); return 1; })()`);
  check(await B.ev(`until(() => S.blocks['${bId}'].notes?.length === 1 && el('${bId}').querySelector('.ncount').textContent === '1' && document.querySelector('#toast').textContent.includes('why log1p'))`), 'comment syncs to Bob with count badge and notification (gap 6)');
  check(await B.ev(`(async()=>{ el('${bId}').querySelector('[aria-label=Comments]').click(); return until(() => el('${bId}').querySelector('.nlist')?.textContent.includes('why log1p here?')); })()`), 'comment thread renders');
  // prompt edits without regeneration are versioned
  await A.ev(`(async()=>{ await until(() => el('${fId}')); const p = el('${fId}').querySelector('.prompt'); p.focus(); p.textContent = 'remove rows with Fare above 250'; p.dispatchEvent(new Event('input', { bubbles: true })); p.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); return 1; })()`); // background tabs fire no blur events
  check(await A.ev(`until(() => S.blocks['${fId}'].hist.at(-1).action === 'edit prompt text' && text(S.blocks['${fId}']) === 'remove rows with Fare above 250')`), 'a prompt edit without regeneration becomes a history version');
  // small UI pieces: jump to node, Reset output, reorder
  check(await A.ev(`(()=>{ const n = S.blocks['${bId}'].segs.find(s => s.t==='node').id; jump('${bId}', n); return el('${bId}').querySelector('.node[data-n="' + n + '"]').getAnimations().length > 0; })()`), 'jumping from a message pulses the node itself');
  await A.ev(`(()=>{ el(byText('load data').id).querySelector('.rst').click(); return 1; })()`);
  check(await B.ev(`until(() => S.blocks[byText('load data').id].out === null)`), 'Reset clears the output in both windows');
  await A.ev(`moveBlock('${cId}', byText('drop columns').id, false)`);
  check(await B.ev(`until(() => { const o = ordered().map(b => b.id); return o.indexOf('${cId}') === o.indexOf(byText('drop columns').id) - 1; })`), 'reordering moves the block (synced)');
  check(await A.ev(`document.querySelectorAll('#editor .grip').length === ordered().length`), 'every block has a drag handle');

  // 8. earlier bug fixes: focused-but-untouched prompt takes remote edits; trailing space trimmed; deleted blocks silence links
  await B.ev(`(()=>{ const p = el(byText('drop columns').id).querySelector('.prompt'); p.focus(); return document.activeElement === p; })()`);
  await A.ev(`(()=>{ const b = byText('drop columns'); b.segs = [...b.segs, { t: 'text', v: ' (edited by Alice)' }]; put('blocks', b); })()`);
  check(await B.ev(`until(() => document.activeElement.classList.contains('prompt') && document.activeElement.textContent.includes('(edited by Alice)'))`), 'focused (untouched) prompt shows a collaborator’s edit');
  await B.ev(`document.activeElement.blur(); 1`);
  const tId = await A.ev(`newPrompt('5. Deal with outliers', 'remove outliers of df using IQR')`);
  check(await A.ev(`(async()=>{ await until(() => el('${tId}')?.querySelector('.prompt').textContent.includes('IQR')); const p = el('${tId}').querySelector('.prompt'); p.focus(); const tn = [...p.childNodes].find(n => n.nodeType === 3); const i = tn.data.indexOf('df'); const r = document.createRange(); r.setStart(tn, i); r.setEnd(tn, i + 3); getSelection().removeAllRanges(); getSelection().addRange(r); document.querySelector('#mk').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); p.blur(); return JSON.stringify(S.blocks['${tId}'].segs.map(s => s.v)); })()`) === JSON.stringify(['remove outliers of ', 'df', ' using IQR']), 'selection "df " becomes node "df" (space kept outside)');
  await A.ev(`(async()=>{ SOURCE = null; const l = acts('link')[0]; const b = S.blocks[l.tgt.b]; b.del = true; put('blocks', b); window.__c0 = __calls; await commitCode(l.src.b, 'df = df.dropna()', 'edit code'); })()`);
  check(await A.ev(`__calls === __c0`), 'link to a deleted block makes no LLM call');

  // 9. explain + history views render; wiki shows dots, message panel populated
  check(await A.ev(`(async()=>{ const id = '${encId}'; el(id).querySelector('[aria-label=Explain]').click(); return until(() => el(id).querySelector('.xcode mark, .xcode div[data-i]')); })()`), 'explain view renders');
  check(await A.ev(`(async()=>{ const id = byText('drop columns').id; el(id).querySelector('[aria-label=History]').click(); await until(() => el(id).querySelector('.hrow')); el(id).querySelector('.hrow').click(); return until(() => el(id).querySelector('.dcode')); })()`), 'history diff renders');
  check(await A.ev(`document.querySelectorAll('#wiki .dots i').length > 0 && document.querySelectorAll('#msgs .msg').length >= 6`), 'wiki dots + message panel populated');

  // 10. asynchronous case: Bob closes his window, Alice changes his block, Bob comes back → highlighted + notice
  await B.kill(); await sleep(500);
  await A.ev(`(async()=>{ const b = S.blocks['${b2}']; await commitCode('${b2}', b.code + '\\nprint(1)', 'edit code'); return 1; })()`);
  B = await page(BASE + '?user=Bob'); await sleep(2000);
  await B.ev(INJECT);
  check(await B.ev(`until(() => el('${b2}')?.classList.contains('unseen') && el('${b2}').querySelector('.newtag').textContent === 'Updated by Alice · edit code')`), 'a change made while Bob was offline is highlighted when he returns');
  check(await B.ev(`until(() => document.querySelector('#toast').textContent.includes('while you were away'))`), 'Bob gets a “changed while you were away” notice');
  console.log('LLM calls (stubbed) in Alice:', await A.ev('__calls'));
  await A.kill(); await B.kill();
} catch (e) { ok = false; console.log('ERROR', e.message); }
proc.kill(); console.log(`${nPass}/${nAll} passed`); console.log(ok ? 'ALL PASS' : 'SOME FAILED'); process.exit(ok ? 0 : 1);
