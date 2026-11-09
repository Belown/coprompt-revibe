// Two-window end-to-end check of the CoPrompt revibe via CDP (LLM stubbed). Usage: node e2e.mjs
import { spawn } from 'node:child_process';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://localhost:8765/';
const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9333',
  `--user-data-dir=${process.env.TEMP}/cp_e2e_${Date.now()}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };

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
  return { ev, close: () => ws.close() };
}
const STUB = `llm = async (u, json) => {
  const p = (u.match(/\\[\\$PROMPT\\]: (.*)/) || [])[1] || '';
  if (u.includes('[ADD]')) return p.includes('missing') ? "df = df.drop(columns=['Cabin'])\\ndf['Age'] = df['Age'].fillna(df['Age'].median())\\nprint(df.isna().sum().sum())" : "df_encoded = pd.get_dummies(df, columns=['Sex','Embarked'])\\nprint(df_encoded.shape)";
  if (u.includes('AI Python code editor')) return "df_encoded = pd.get_dummies(df, columns=['Sex'])\\nprint(df_encoded.shape)";
  if (u.includes('code dependencies')) return [{ id: 'x', index: 1, updated: true, updated_code: 'print(df_encoded.skew(numeric_only=True))', updated_phrase: 'df_encoded' }];
  if (u.includes('fulfills specific user requests')) return [{ id: 'x', index: 1, fulfilled: true }];
  if (u.includes('[$NODE]')) return { node_text: 'df_encoded', code: 'print(df_encoded.skew(numeric_only=True).round(2))' };
  if (u.includes('step by step')) return { steps: [{ phrase: 'encode', lines: [1], explanation: 'one-hot' }] };
  throw new Error('unexpected prompt');
}; window.__calls = 0; const _l = llm; llm = (...a) => (window.__calls++, _l(...a));`;
// helpers evaluated in-page
const H = `
window.byText = t => ordered().find(b => text(b).includes(t));
window.newPrompt = async (afterText, t) => { addBlock('p', byText(afterText).id); const id = ordered().find(b => b.kind==='p' && !b.segs.length).id;
  const p = document.querySelector('[data-id="'+id+'"] .prompt'); p.textContent = t; commitPrompt(id); await generate(id); return id; };
window.makeNode = (id, word) => { const p = document.querySelector('[data-id="'+id+'"] .prompt'); p.focus();
  const tn = [...p.childNodes].find(n => n.nodeType===3 && n.textContent.includes(word)); const i = tn.textContent.lastIndexOf(word);
  const r = document.createRange(); r.setStart(tn, i); r.setEnd(tn, i + word.length); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  document.querySelector('#mk').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); p.blur(); return SOURCE; };
window.until = async (f, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await new Promise(r => setTimeout(r, 100)); } return false; };
window.clickOK = () => { const b = document.querySelector('#modal .primary'); if (!b) return false; const i = document.querySelector('#modal input'); if (i) i.value = 'fill missing values instead of dropping the columns'; b.click(); return true; };`;

try {
  const A = await page(BASE + '?user=Alice'); await sleep(1500);
  const B = await page(BASE + '?user=Bob'); await sleep(1500);
  for (const P of [A, B]) await P.ev(STUB + H + ';1');

  // 1. Python execution of the seeded block
  check(await A.ev(`(async()=>{ await run(byText('load data').id); return S.blocks[byText('load data').id].out.text.includes('PassengerId'); })()`), 'Pyodide (Web Worker) runs seeded block (df.head())');
  await A.ev(`window.__busy = pyRun(['import time\\nt = time.time()\\nwhile time.time() - t < 3: pass']); 1`);
  const t0 = Date.now(); await A.ev('1 + 1'); const dt = Date.now() - t0;
  check(dt < 1000, `page answers within ${dt} ms while Python busy-loops for 3 s`);
  await A.ev('__busy.then(() => 1)');
  check(await B.ev(`until(() => S.blocks[byText('load data').id].out?.text.includes('PassengerId'))`), 'execution output synced to Bob');

  // 2. Alice adds a prompt; code generated; Bob sees it
  await A.ev(`newPrompt('1. Deal with missing', 'drop columns with missing values in df')`);
  check(await B.ev(`until(() => byText('drop columns')?.code.includes('fillna'))`), 'new prompt + generated code synced to Bob');
  const encId = await A.ev(`newPrompt('2. Encode', 'encode categorical features in df')`);
  check(await A.ev(`(async()=>{ await run('${encId}'); return S.blocks['${encId}'].out.text.includes('891'); })()`), 'run chains earlier blocks (fresh namespace)');

  // 3. Bob: refer — source node 'df' in Bob's prompt → target Alice's encode prompt
  const bId = await B.ev(`newPrompt('3. Feature transformation', 'calculate the skewness of all features in df')`);
  await B.ev(`makeNode('${bId}', 'df')`);
  await B.ev(`mech('refer', byText('encode categorical').id, document.body)`);
  check(await B.ev(`until(() => S.blocks['${bId}'].segs.some(s => s.t==='node' && s.v==='df_encoded'))`), 'refer rewrites source node (df → df_encoded)');
  check(await A.ev(`until(() => Object.values(S.actions).some(a => a.type==='refer'))`), 'refer action appears in Alice’s message panel');

  // 4. Bob: request — Alice changes her encode prompt → fulfilment check → Bob's block regenerates
  const b2 = await B.ev(`newPrompt('4. Correlation', 'correlation matrix of df')`);
  await B.ev(`makeNode('${b2}', 'df')`);
  const reqP = B.ev(`mech('request', byText('encode categorical').id, document.body)`);
  check(await B.ev(`until(() => clickOK())`), 'request dialog answered');
  await reqP;
  check(await A.ev(`until(() => Object.values(S.actions).some(a => a.type==='request' && a.status==='open'))`), 'request is pending for Alice');
  await A.ev(`(async()=>{ const id = byText('encode categorical').id; document.querySelector('[data-id="'+id+'"] .prompt').textContent='encode only Sex in df'; commitPrompt(id); await generate(id); })()`);
  check(await B.ev(`until(() => Object.values(S.actions).some(a => a.type==='request' && a.status==='fulfilled') && S.blocks['${b2}'].code.includes('round(2)'))`), 'request fulfilled → requester block regenerated');

  // 5. Alice: link her missing-values prompt node 'df' → Bob's skewness prompt; edit code → Bob's code updates
  await A.ev(`makeNode(byText('drop columns').id, 'df')`);
  await A.ev(`mech('link', '${bId}', document.body)`);
  await A.ev(`(async()=>{ await commitCode(byText('drop columns').id, "df = df.dropna(subset=['Embarked'])", 'edit code'); })()`);
  check(await B.ev(`until(() => S.blocks['${bId}'].hist.some(h => h.action==='link'))`), 'link propagates a code change to the linked block');

  // 6. Bob shares to Alice → popup in Alice's window → accept → regenerate
  await B.ev(`makeNode('${b2}', 'matrix')`);
  await B.ev(`mech('share', byText('drop columns').id, document.body)`);
  check(await A.ev(`until(() => clickOK())`), 'share pop-up appears for Alice and is accepted');
  check(await A.ev(`until(() => Object.values(S.actions).some(a => a.type==='share' && a.status==='accepted') && byText('drop columns').hist.some(h => h.action==='share'))`), 'accepted share regenerates Alice’s block');

  // 6b. bug fixes: focused-but-untouched prompt takes remote edits; trailing space trimmed; deleted blocks silence links
  await B.ev(`(()=>{ const p = document.querySelector('[data-id="' + byText('drop columns').id + '"] .prompt'); p.focus(); return document.activeElement === p; })()`);
  await A.ev(`(()=>{ const b = byText('drop columns'); b.segs = [...b.segs, { t: 'text', v: ' (edited by Alice)' }]; put('blocks', b); })()`);
  check(await B.ev(`until(() => document.activeElement.classList.contains('prompt') && document.activeElement.textContent.includes('(edited by Alice)'))`), 'focused (untouched) prompt shows a collaborator’s edit');
  const tId = await A.ev(`newPrompt('5. Deal with outliers', 'remove outliers of df using IQR')`);
  check(await A.ev(`(()=>{ const p = document.querySelector('[data-id="${tId}"] .prompt'); p.focus(); const tn = [...p.childNodes].find(n => n.nodeType === 3); const i = tn.data.indexOf('df'); const r = document.createRange(); r.setStart(tn, i); r.setEnd(tn, i + 3); getSelection().removeAllRanges(); getSelection().addRange(r); document.querySelector('#mk').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); p.blur(); return JSON.stringify(S.blocks['${tId}'].segs.map(s => s.v)); })()`) === JSON.stringify(['remove outliers of ', 'df', ' using IQR']), 'selection "df " becomes node "df" (space kept outside)');
  await A.ev(`(async()=>{ SOURCE = null; const l = Object.values(S.actions).find(a => a.type==='link'); const b = S.blocks[l.tgt.b]; b.del = true; put('blocks', b); window.__c0 = __calls; await commitCode(l.src.b, 'df = df.dropna()', 'edit code'); })()`);
  check(await A.ev(`__calls === __c0`), 'link to a deleted block makes no LLM call');

  // 7. explain + history views render; wiki shows mechanism pills/dots
  check(await A.ev(`(async()=>{ const id = byText('encode').id; await explain(id); return !!document.querySelector('[data-id="'+id+'"] .xcode'); })()`), 'explain view renders');
  check(await A.ev(`(()=>{ const id = byText('drop columns').id; history(id); document.querySelector('[data-id="'+id+'"] .hrow').click(); return !!document.querySelector('[data-id="'+id+'"] .dcode'); })()`), 'history diff renders');
  check(await A.ev(`document.querySelectorAll('#wiki .dots i').length > 0 && document.querySelectorAll('#msgs .msg').length >= 4`), 'wiki dots + message panel populated');
  console.log('LLM calls (stubbed) in Bob:', await B.ev('__calls'), 'Alice:', await A.ev('__calls'));
  A.close(); B.close();
} catch (e) { ok = false; console.log('ERROR', e.message); }
proc.kill(); console.log(ok ? 'ALL PASS' : 'SOME FAILED'); process.exit(ok ? 0 : 1);
