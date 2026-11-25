// The offline demo, walked through like the guide on frontend/demo/: one page, Alice and Bob as its two frames,
// the scripted model (no stub, no server). Usage (in frontend/): npm run build && npm run preview, then
// node ../tests/demo-e2e.mjs   (DEMO_BASE overrides the URL, e.g. http://localhost:8001/demo/)
import { spawn } from 'node:child_process';
const EDGE = process.env.E2E_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = process.env.DEMO_BASE || 'http://localhost:8000/demo/';
const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9334', '--window-size=1600,1000',
  `--user-data-dir=${process.env.TEMP || '/tmp'}/cp_demo_${Date.now()}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ok = true, nPass = 0, nAll = 0;
const check = (c, m) => { nAll++; if (c) nPass++; console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };

async function page(url) {
  for (let i = 0; i < 50; i++) { try { await fetch('http://localhost:9334/json/version'); break; } catch { await sleep(200); } }
  const t = await (await fetch(`http://localhost:9334/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let n = 0; const pend = {};
  ws.onmessage = e => { const d = JSON.parse(e.data); if (pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
  const send = (method, params) => new Promise(r => { const id = ++n; pend[id] = r; ws.send(JSON.stringify({ id, method, params })); });
  return async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
    return r.result?.result?.value;
  };
}
// helpers, evaluated inside each frame (the app exposes its functions as window.cp)
function helpers() {
  for (const k of Object.keys(cp)) if (k !== 'S') window[k] = cp[k];
  Object.defineProperty(window, 'S', { get: () => cp.S, configurable: true });
  window.el = id => document.querySelector('#editor [data-id="' + id + '"]');
  window.byText = t => ordered().find(b => text(b).includes(t));
  window.acts = (t, f = () => true) => Object.values(S.actions).filter(a => a.type === t && f(a));
  window.nHist = (id, act) => (S.blocks[id].hist || []).filter(h => h.action === act).length;
  window.until = async (f, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await new Promise(r => setTimeout(r, 100)); } return false; };
  window.newPrompt = async (after, t) => { const id = addBlock('p', byText(after).id); setPromptText(id, t); await generate(id); return id; };
  window.makeNode = async (id, word) => { await until(() => nodeFromWord(id, word)); const e = editorOf(id); e.commands.blur(); e.view.dom.dispatchEvent(new FocusEvent('blur')); };
  window.clickOK = (v = '') => { const b = document.querySelector('#modal .primary'); if (!b) return false; const i = document.querySelector('#modal input'); if (i) i.value = v; b.click(); return true; };
  window.runOut = async id => { await run(id); const o = S.blocks[id].out; return o.err ? 'ERR ' + o.err : (o.text || '') + (o.img ? '[plot]' : ''); };
}

const ev = await page(BASE);
const frame = u => `document.querySelector('iframe[data-u=${u}]').contentWindow`;
const A = x => ev(`Promise.resolve(${frame('Alice')}.eval(${JSON.stringify(x)}))`), B = x => ev(`Promise.resolve(${frame('Bob')}.eval(${JSON.stringify(x)}))`);
try {
  const up = u => `document.querySelector('iframe[data-u=${u}]')?.contentWindow?.cp`;
  for (let i = 0; i < 150 && !(await ev(`!!(${up('Alice')} && ${up('Bob')})`)); i++) await sleep(200);
  for (const P of [A, B]) await P(`(${helpers})(); 1`);
  check(await A(`until(() => ordered().some(b => b.author === 'Alice') && ordered().some(b => b.author === 'Bob'))`), 'the demo starts with Alice and Bob owning their tasks');
  check(await ev(`!!document.querySelector('iframe[data-u=Alice].on') && getComputedStyle(document.querySelector('iframe[data-u=Bob]')).visibility === 'hidden'`), 'Alice’s view is shown, Bob’s is loaded but hidden');
  const py = await A(`(async()=>{ await until(() => cp.ui.py.s !== 'load', 180000); return cp.ui.py; })()`);
  if (py.s !== 'ok') throw new Error('Python did not load (CDN unreachable?): ' + py.text);
  check((await A(`runOut(byText('load data').id)`)).includes('PassengerId'), '1. load data runs');

  const d = await A(`newPrompt('1. Deal with missing', 'drop columns with missing values in df')`);
  check((await A(`runOut('${d}')`)).includes('891'), '2. drop columns: scripted code runs');
  const enc = await A(`newPrompt('2. Encode', 'encode categorical features in df and store the result as df_encoded')`);
  check(!(await A(`runOut('${enc}')`)).startsWith('ERR'), '3. encode into df_encoded runs');

  const sk = await B(`newPrompt('3. Feature transformation', 'calculate the skewness of all features in df')`);
  await B(`makeNode('${sk}', 'df')`);
  await B(`(async () => { const p = mech('refer', '${enc}', document.body); await until(() => clickOK()); await p; return 1; })()`);
  check(await B(`until(() => text(S.blocks['${sk}']) === 'calculate the skewness of all features in df_encoded' && S.blocks['${sk}'].code.startsWith('df_encoded.skew'))`), '4. refer: Bob’s prompt and code move to df_encoded');
  check(!(await B(`runOut('${sk}')`)).startsWith('ERR'), '4. the referred block runs');

  const hm = await B(`newPrompt('4. Correlation', 'plot the correlation matrix of df as a heatmap')`);
  check((await B(`runOut('${hm}')`)).includes('[plot]'), '5. heatmap draws a plot');
  await B(`makeNode('${hm}', 'df')`);
  await B(`(async () => { const p = mech('request', '${d}', document.body); await until(() => clickOK('fill missing values instead of dropping the columns')); await p; return 1; })()`);
  check(await A(`until(() => acts('request', a => a.status === 'open').length === 1)`), '5. request is open for Alice');
  check(await ev(`new Promise(r => setTimeout(() => r(document.querySelector('[data-v=Alice] .badge').textContent), 700))`) !== '', 'the Alice tab shows that something is waiting');

  await A(`(async () => { setPromptText('${d}', 'fill missing values in df without dropping any rows or columns'); await generate('${d}'); return 1; })()`);
  check(await B(`until(() => acts('request', a => a.status === 'fulfilled').length === 1 && nHist('${hm}', 'request') === 1)`), '6. request fulfilled: Bob’s heatmap regenerated');
  check(!(await A(`runOut('${d}')`)).startsWith('ERR'), '6. fill missing values runs');

  const out = await A(`newPrompt('5. Deal with outliers', 'remove outliers of df')`);
  await B(`makeNode('${sk}', 'skewness')`);
  await B(`(async () => { const p = mech('share', '${out}', document.body); await until(() => clickOK()); await p; return 1; })()`);
  await ev(`document.querySelector('[data-v=Bob]').click(), 1`);
  check(await ev(`new Promise(r => setTimeout(() => r(document.querySelector('[data-v=Alice] .badge').textContent), 700))`) === 'pop-up', '7. viewing Bob, the Alice tab says a pop-up is waiting');
  await ev(`document.querySelector('[data-v=Alice]').click(), 1`);
  check(await A(`until(() => document.querySelector('#modal')?.textContent.includes('shared') && clickOK())`), '7. Alice accepts the share');
  check(await A(`until(() => S.blocks['${out}'].code.includes('skew()) > 1'))`), '7. share: the outlier filter only uses skewed columns');
  check(!(await A(`runOut('${out}')`)).startsWith('ERR'), '7. outliers run');

  await A(`makeNode('${d}', 'df')`);
  await A(`(async () => { // select "df" in the encode row of the wiki, as a target phrase, then link
    const row = document.querySelector('#wiki [data-bid="${enc}"]'), sp = [...row.querySelectorAll('[data-si]')].find(s => / df /.test(s.textContent));
    const i = sp.textContent.indexOf(' df ') + 1, r = document.createRange(); r.setStart(sp.firstChild, i); r.setEnd(sp.firstChild, i + 2);
    getSelection().removeAllRanges(); getSelection().addRange(r);
    const p = mech('link', '${enc}', row); await until(() => clickOK()); await p; return 1; })()`);
  check(await A(`until(() => acts('link').length === 1)`), '8. link created');
  await A(`(async () => { setPromptText('${d}', text(S.blocks['${d}']) + ' and store the result as df_filled'); await generate('${d}'); return 1; })()`);
  check(await A(`until(() => S.blocks['${enc}'].code.includes('get_dummies(df_filled') && segs('${enc}').some(s => s.t === 'node' && s.v === 'df_filled'))`), '8. link: the encode prompt and code follow to df_filled');
  check(await B(`until(() => text(S.blocks['${hm}']).includes('df_filled'))`), '8. the tracked request moves Bob’s heatmap to df_filled too');
  for (const id of [enc, sk, hm, out]) check(!(await A(`runOut('${id}')`)).startsWith('ERR'), `8. the notebook still runs after the link (${id})`);

  check(await B(`(async () => { el('${hm}').querySelector('[aria-label=Explain]').click(); return until(() => el('${hm}').querySelectorAll('.xsteps li').length > 1 && el('${hm}').querySelector('.xprompt mark')); })()`), '9. explanation view: steps and highlighted phrases');
  check(await A(`(async () => { el('${d}').querySelector('[aria-label=History]').click(); return until(() => el('${d}').querySelectorAll('.hrow').length >= 3); })()`), '9. history view lists the versions');

  const cf = await A(`(async () => { const id = addBlock('p', '${out}'); await until(() => el(id)); S.blocks[id].code = "# survival rate by class\\ndf.groupby('Pclass')['Survived'].mean()"; await promptFromCode(id); return id; })()`);
  check(await A(`until(() => text(S.blocks['${cf}']) === 'compute the survival rate by class in df')`), '10. prompt from code');
  await ev(`document.querySelector('[data-v=both]').click(), 1`);
  check(await ev(`[...document.querySelectorAll('iframe')].every(f => getComputedStyle(f).visibility === 'visible' && f.offsetWidth > 500)`), 'side by side shows both views');
  check(await A(`(async () => { setPromptText(byText('load data').id, 'train a neural network on df'); await generate(byText('train a neural').id); return [...document.querySelectorAll('#toast div')].some(t => t.textContent.includes('scripted answers')); })()`), 'an off-script prompt gets a clear message, no code');
} catch (e) { check(false, 'crashed: ' + e.message); }
console.log(`${nPass}/${nAll} passed`); console.log(ok ? 'ALL PASS' : 'SOME FAILED');
proc.kill(); process.exit(ok ? 0 : 1);
