// The offline demo, walked through like its guide (frontend/demo/) with real input: mouse clicks and double-clicks,
// typing and Enter, at projector size (1280×720). One page, Alice and Bob as its two frames, the scripted model.
// Usage (in frontend/): npm run build && npm run preview, then node ../tests/demo-e2e.mjs
// DEMO_BASE overrides the URL (e.g. http://localhost:8001/demo/), DEMO_SIZE the window (e.g. 1920,1080).
import { spawn } from 'node:child_process';
const EDGE = process.env.E2E_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = process.env.DEMO_BASE || 'http://localhost:8000/demo/';
const [W, H] = (process.env.DEMO_SIZE || '1280,720').split(',').map(Number);
// DEMO_OFFLINE=1: the CDN and Google Fonts do not resolve, as without internet (the demo must use its own Pyodide)
const OFFLINE = process.env.DEMO_OFFLINE ? ['--host-resolver-rules=MAP cdn.jsdelivr.net ~NOTFOUND, MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND'] : [];
// Windows' native occlusion detection stops all rendering in a browser window it thinks is covered, which happens on an
// idle machine (a test run overnight): no frames, and every mouse event then waits 5 s. A presenter's window is in front.
const NO_OCCLUSION = ['--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows'];
// DEMO_HEADFUL=1: a visible window instead of headless
// a throwaway browser profile (~0.5 GB with Pyodide cached), deleted when the run ends
const PROFILE = `${process.env.TEMP || '/tmp'}/cp_demo_${Date.now()}`;
const cleanup = async () => { proc.kill(); for (let i = 0; i < 20; i++) { try { (await import('node:fs')).rmSync(PROFILE, { recursive: true, force: true }); return; } catch { await new Promise(r => setTimeout(r, 500)); } } };
const proc = spawn(EDGE, [...(process.env.DEMO_HEADFUL ? ['--window-position=40,40', '--no-first-run', '--no-default-browser-check'] : ['--headless=new', '--disable-gpu']), ...NO_OCCLUSION, ...OFFLINE, '--remote-debugging-port=9334', `--window-size=${W},${H}`,
  `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ok = true, nPass = 0, nAll = 0;
const check = (c, m) => { nAll++; if (c) nPass++; console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };

async function page(url) {
  for (let i = 0; i < 50; i++) { try { await fetch('http://localhost:9334/json/version'); break; } catch { await sleep(200); } }
  // the browser's first tab: it is the foreground one (a new tab would be throttled like a background tab)
  let t; for (let i = 0; i < 50 && !t; i++) { t = (await (await fetch('http://localhost:9334/json/list')).json()).find(x => x.type === 'page'); if (!t) await sleep(200); }
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let n = 0; const pend = {};
  ws.onmessage = e => { const d = JSON.parse(e.data); if (pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
  const send = (method, params) => new Promise(r => { const id = ++n; pend[id] = r; ws.send(JSON.stringify({ id, method, params })); });
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
    return r.result?.result?.value;
  };
  await send('Page.navigate', { url }); await sleep(500);
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  return { ev, send };
}
// helpers, evaluated inside each frame (the app exposes its functions as window.cp); only for finding things and checking
function helpers() {
  for (const k of Object.keys(cp)) if (k !== 'S') window[k] = cp[k];
  Object.defineProperty(window, 'S', { get: () => cp.S, configurable: true });
  window.el = id => document.querySelector('#editor [data-id="' + id + '"]');
  window.byText = t => ordered().find(b => text(b).includes(t));
  window.hid = t => ordered().find(b => b.kind === 'h' && b.text.startsWith(t)).id;
  window.acts = (t, f = () => true) => Object.values(S.actions).filter(a => a.type === t && f(a));
  window.nHist = (id, act) => (S.blocks[id].hist || []).filter(h => h.action === act).length;
  window.until = async (f, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await new Promise(r => setTimeout(r, 100)); } return false; };
  window.outOf = id => { const o = S.blocks[id].out; return !o ? '' : o.err ? 'ERR ' + o.err : (o.text || '') + (o.img ? '[plot]' : ''); };
  // centre of an element, or of the last occurrence of a word inside it, scrolled into view (frame coordinates)
  window.spot = (sel, word) => {
    const e = typeof sel === 'string' ? document.querySelector(sel) : sel; if (!e) return null;
    e.scrollIntoView({ block: 'center' });
    let r = e.getBoundingClientRect();
    if (word) {
      const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT); let hit = null;
      for (let t; (t = w.nextNode());) { // the last whole-word occurrence (df, not the df in df_encoded)
        const m = [...t.data.matchAll(new RegExp(`(?<!\\w)${word}(?!\\w)`, 'g'))].at(-1);
        if (m && !t.parentElement.closest('.node')) hit = [t, m.index];
      }
      if (!hit) return null;
      const g = document.createRange(); g.setStart(hit[0], hit[1]); g.setEnd(hit[0], hit[1] + word.length); r = g.getBoundingClientRect();
    }
    return r.width ? [r.x + r.width / 2, r.y + r.height / 2] : null;
  };
  // the right end of an element's last line (a click there puts the caret at the end of the text)
  window.spotEnd = sel => { const e = document.querySelector(sel); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.right - 4, r.bottom - 12]; };
}

const { ev, send } = await page(BASE);
const fr = u => `document.querySelector('iframe[data-u=${u}]').contentWindow`;
const inF = u => x => ev(`Promise.resolve(${fr(u)}.eval(${JSON.stringify(x)}))`);
const A = inF('Alice'), B = inF('Bob'), P = { Alice: A, Bob: B };
// real input, at page coordinates (a frame's coordinates plus the frame's offset)
async function at(u, sel, word) {
  for (let i = 0; i < 50; i++) {
    const p = await P[u](`spot(${sel}, ${JSON.stringify(word ?? null)})`);
    if (p) { const o = await ev(`(r => [r.x, r.y])(document.querySelector('iframe[data-u=${u}]').getBoundingClientRect())`); return [p[0] + o[0], p[1] + o[1]]; }
    await sleep(200);
  }
  throw new Error(`not found in ${u}: ${sel} ${word ?? ''}`);
}
const mouse = (type, [x, y], clickCount = 1) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount });
// On this machine, once idle, every browser stops drawing ~20 s after start (a bare button page too; GPU on or off);
// then each mouseMoved waits 5 s for its acknowledgement while press and release stay instant. So clicks press and
// release, and only hover() moves the mouse, where the UI needs a hover.
async function click(u, sel, word) { const p = await at(u, sel, word); await mouse('mousePressed', p); await mouse('mouseReleased', p); await sleep(150); }
async function dbl(u, sel, word) {
  const p = await at(u, sel, word);
  await mouse('mousePressed', p, 1); await mouse('mouseReleased', p, 1); await mouse('mousePressed', p, 2); await mouse('mouseReleased', p, 2); await sleep(250);
}
async function hover(u, sel) { await mouse('mouseMoved', await at(u, sel)); await sleep(200); }
const type = async t => { await send('Input.insertText', { text: t }); await sleep(100); };
const key = async (k, code, vk, modifiers = 0, commands) => { for (const t of ['rawKeyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type: t, key: k, code, windowsVirtualKeyCode: vk, modifiers, ...(t === 'rawKeyDown' && commands && { commands }) }); await sleep(120); };
const enter = () => key('Enter', 'Enter', 13);
// DEMO_VIEW=both: the whole guide side by side (switching views is then skipped)
const view = async v => { await click0(`[data-v=${process.env.DEMO_VIEW || v}]`); await sleep(300); };
async function click0(sel) { const p = await ev(`(r => [r.x + r.width / 2, r.y + r.height / 2])(document.querySelector('${sel}').getBoundingClientRect())`); await mouse('mousePressed', p); await mouse('mouseReleased', p); }
const q = s => JSON.stringify(s);
// + block under a heading (hover shows its controls), type the prompt, Enter: the new block's id
async function newPrompt(u, heading, prompt) {
  const h = await P[u](`hid(${q(heading)})`);
  await hover(u, q(`[data-id="${h}"]`));
  await click(u, q(`[data-id="${h}"] .ctl button[title^="Add a block below"]`));
  await type(prompt); await enter();
  const id = await P[u](`(async () => { await until(() => byText(${q(prompt)})); return byText(${q(prompt)}).id; })()`);
  await P[u](`until(() => S.blocks['${id}'].code.trim() && !cp.ui.BUSY['${id}'])`);
  return id;
}
async function runBlock(u, id) {
  await click(u, q(`[data-id="${id}"] .run`));
  await P[u](`until(() => outOf('${id}') && !document.querySelector('[data-id="${id}"] .run').disabled, 60000)`);
  return P[u](`outOf('${id}')`);
}
// double-click a word in a prompt, then Make node in the toolbar that appears over the selection
async function makeNode(u, id, word) {
  await dbl(u, q(`[data-id="${id}"] .prompt`), word);
  await click(u, q(`[data-id="${id}"] .bubble .mk`));
  return P[u](`until(() => cp.ui.SOURCE?.b === '${id}' && cp.ui.SOURCE.n)`);
}
// a mechanism pill on a wiki row (it shows while a source is picked), then the dialog: optional note, OK
async function mech(u, type_, tgt, note = '') {
  await hover(u, q(`#wiki [data-bid="${tgt}"]`));
  const pill = q(`#wiki [data-bid="${tgt}"] .pill[title^="${type_[0].toUpperCase() + type_.slice(1)}:"]`);
  await click(u, pill);
  if (!(await P[u](`until(() => document.querySelector('#modal .dlg'), 5000)`))) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    (await import('node:fs')).writeFileSync(`${process.env.TEMP || '/tmp'}/demo-fail.png`, Buffer.from(shot.result.data, 'base64'));
    throw new Error(`no dialog after ${type_}: ` + await P[u](`(() => { const p = spot(${pill}); const e = p && document.elementFromPoint(...p);
      return JSON.stringify({ src: cp.ui.SOURCE, pill: p, hit: e && (e.className + ' ' + (e.title || e.textContent).slice(0, 60)), toasts: [...document.querySelectorAll('#toast div')].map(t => t.textContent) }); })()`));
  }
  if (note) { await type(note); }
  await click(u, q('#modal .primary'));
}

try {
  const up = u => `document.querySelector('iframe[data-u=${u}]')?.contentWindow?.cp`;
  for (let i = 0; i < 150 && !(await ev(`!!(${up('Alice')} && ${up('Bob')})`)); i++) await sleep(200);
  for (const f of [A, B]) await f(`(${helpers})(); 1`);
  check(await A(`until(() => ordered().some(b => b.author === 'Alice') && ordered().some(b => b.author === 'Bob'))`), 'the demo starts with Alice and Bob owning their tasks');
  if (process.env.DEMO_VIEW) await view(process.env.DEMO_VIEW);
  const t0 = Date.now();
  const py = await A(`(async()=>{ await until(() => cp.ui.py.s !== 'load' && ${fr('Bob').replace('document', 'parent.document')}.cp.ui.py.s !== 'load', 180000); return cp.ui.py; })()`);
  if (py.s !== 'ok') throw new Error('Python did not load (CDN unreachable?): ' + py.text);
  console.log(`     (Python ready in both views after ${((Date.now() - t0) / 1000).toFixed(0)} s)`);

  const load = await A(`byText('load data').id`);
  check((await runBlock('Alice', load)).includes('PassengerId'), '1. Alice runs “load data”');

  const d = await newPrompt('Alice', '1. Deal with missing', 'drop columns with missing values in df');
  check((await runBlock('Alice', d)).includes('891'), '2. + block, type, Enter: the scripted code runs');
  const enc = await newPrompt('Alice', '2. Encode', 'encode categorical features in df and store the result as df_encoded');
  check(!(await runBlock('Alice', enc)).startsWith('ERR'), '3. encode into df_encoded runs');

  await view('Bob');
  const sk = await newPrompt('Bob', '3. Feature transformation', 'calculate the skewness of all features in df');
  check(await makeNode('Bob', sk, 'df'), '4. double-click df, Make node: the source is set');
  await mech('Bob', 'refer', enc);
  check(await B(`until(() => text(S.blocks['${sk}']) === 'calculate the skewness of all features in df_encoded' && S.blocks['${sk}'].code.startsWith('df_encoded.skew'))`), '4. refer: Bob’s prompt and code move to df_encoded');
  check(!(await runBlock('Bob', sk)).startsWith('ERR'), '4. the referred block runs');

  const hm = await newPrompt('Bob', '4. Correlation', 'plot the correlation matrix of df as a heatmap');
  check((await runBlock('Bob', hm)).includes('[plot]'), '5. the heatmap draws a plot');
  await makeNode('Bob', hm, 'df');
  await mech('Bob', 'request', d, 'fill missing values instead of dropping the columns');
  check(await A(`until(() => acts('request', a => a.status === 'open' && a.msg.startsWith('fill missing')).length === 1)`), '5. request (with its note) is open for Alice');
  check(await ev(`new Promise(r => setTimeout(() => r(document.querySelector('[data-v=Alice] .badge').textContent), 800))`) !== '', '5. the Alice tab shows that something is waiting');

  await view('Alice');
  await click('Alice', q(`[data-id="${d}"] .prompt`));
  await key('a', 'KeyA', 65, 2); // Ctrl+A in the prompt, then type over it
  await type('fill missing values in df without dropping any rows or columns'); await enter();
  check(await B(`until(() => acts('request', a => a.status === 'fulfilled').length === 1 && nHist('${hm}', 'request') === 1)`), '6. request fulfilled: Bob’s heatmap regenerated');
  check(!(await runBlock('Alice', d)).startsWith('ERR'), '6. fill missing values runs');

  const out = await newPrompt('Alice', '5. Deal with outliers', 'remove outliers of df');
  await view('Bob');
  await makeNode('Bob', sk, 'skewness');
  await mech('Bob', 'share', out);
  const badge = await ev(`(async () => { for (let i = 0; i < 50; i++) { const t = document.querySelector('[data-v=Alice] .badge').textContent; if (t === 'pop-up') return t; await new Promise(r => setTimeout(r, 200)); }
    return document.querySelector('[data-v=Alice] .badge').textContent + ' / modal: ' + !!${fr('Alice')}.document.querySelector('#modal:not([hidden])') + ' / ' + ${fr('Alice')}.document.querySelector('#modal')?.outerHTML.slice(0, 120); })()`);
  check(badge === 'pop-up', '7. viewing Bob, the Alice tab says a pop-up is waiting' + (badge === 'pop-up' ? '' : ` (${badge})`));
  await view('Alice');
  await A(`until(() => document.querySelector('#modal')?.textContent.includes('shared'))`);
  await click('Alice', q('#modal .primary'));
  check(await A(`until(() => S.blocks['${out}'].code.includes('skew()) > 1'))`), '7. share accepted: the outlier filter only uses skewed columns');
  check(!(await runBlock('Alice', out)).startsWith('ERR'), '7. outliers run');

  await makeNode('Alice', d, 'df');
  await hover('Alice', q(`#wiki [data-bid="${enc}"]`));
  await dbl('Alice', q(`#wiki [data-bid="${enc}"] .wtext`), 'df');
  await click('Alice', q(`#wiki [data-bid="${enc}"] .pill[title^="Link:"]`));
  await A(`until(() => document.querySelector('#modal .dlg'))`); await click('Alice', q('#modal .primary'));
  check(await A(`until(() => acts('link').length === 1 && segs('${enc}').some(s => s.t === 'node' && s.v === 'df'))`), '8. link from Alice’s df to df selected in the encode row');
  { const p = await A(`spotEnd('[data-id="${d}"] .prompt')`), o = await ev(`(r => [r.x, r.y])(document.querySelector('iframe[data-u=Alice]').getBoundingClientRect())`);
    const xy = [p[0] + o[0], p[1] + o[1]]; await mouse('mousePressed', xy); await mouse('mouseReleased', xy); await sleep(150); }
  await type(' and store the result as df_filled'); await enter();
  check(await A(`until(() => S.blocks['${enc}'].code.includes('get_dummies(df_filled') && segs('${enc}').some(s => s.t === 'node' && s.v === 'df_filled'))`), '8. link: the encode prompt and code follow to df_filled');
  check(await B(`until(() => text(S.blocks['${hm}']).includes('df_filled'))`), '8. the tracked request moves Bob’s heatmap to df_filled too');
  for (const [u, id, what] of [['Alice', enc, 'encode'], ['Bob', sk, 'skewness'], ['Bob', hm, 'heatmap'], ['Alice', out, 'outliers']]) {
    if (u === 'Bob') await view('Bob'); else await view('Alice');
    check(!(await runBlock(u, id)).startsWith('ERR'), `8. the notebook still runs after the link (${what})`);
  }

  await view('Bob');
  await click('Bob', q(`[data-id="${hm}"] [aria-label=Explain]`));
  check(await B(`until(() => el('${hm}').querySelectorAll('.xsteps li').length > 1 && el('${hm}').querySelector('.xprompt mark'))`), '9. explanation view: steps and highlighted phrases');
  await view('Alice');
  await click('Alice', q(`[data-id="${d}"] [aria-label=History]`));
  check(await A(`until(() => el('${d}').querySelectorAll('.hrow').length >= 3)`), '9. history view lists the versions');
  await click('Alice', q(`[data-id="${d}"] .hrow:last-child`));
  check(await A(`until(() => el('${d}').querySelector('.dcode .del, .dcode .ins'))`), '9. picking a version shows the diff');
  await click('Alice', q(`[data-id="${d}"] [aria-label=Comments]`));
  check(await A(`until(() => el('${d}').querySelector('.panel textarea, .panel input'))`), '9. the comments panel opens');

  await hover('Alice', q(`[data-id="${out}"]`));
  await click('Alice', q(`[data-id="${out}"] .ctl button[title^="Add a block below"]`));
  const cf = await A(`(async () => { await until(() => ordered().some(b => b.kind === 'p' && !text(b) && !b.code)); return ordered().find(b => b.kind === 'p' && !text(b) && !b.code).id; })()`);
  await click('Alice', q(`[data-id="${cf}"] .cm-content`));
  await type("# survival rate by class"); await enter(); await type("df.groupby('Pclass')['Survived'].mean()");
  await click('Alice', q(`[data-id="${cf}"] .p2c`));
  check(await A(`until(() => text(S.blocks['${cf}']) === 'compute the survival rate by class in df')`), '10. code first: Prompt from code writes the prompt');
  { const o = await runBlock('Alice', cf); check(o.includes('Pclass'), '10. and the block runs' + (o.includes('Pclass') ? '' : ` (code ${JSON.stringify(await A(`S.blocks['${cf}'].code`))}, output ${JSON.stringify(o.slice(0, 200))})`)); }

  await view('both');
  check(await ev(`[...document.querySelectorAll('iframe')].every(f => getComputedStyle(f).visibility === 'visible' && f.offsetWidth > 400)`), 'side by side shows both views');
  await view('Alice');
  await click('Alice', q(`[data-id="${load}"] .prompt`)); await key('a', 'KeyA', 65, 2); await type('train a neural network on df'); await enter();
  check(await A(`until(() => [...document.querySelectorAll('#toast div')].some(t => t.textContent.includes('scripted answers')))`), 'an off-script prompt gets a clear message');
  check(await A(`S.blocks['${load}'].code.includes('read_csv')`), '… and the block keeps its code');

  // after a rehearsal: Start over in the top bar (two clicks) clears both views
  await click0('#restart'); check(await ev(`document.querySelector('#restart').textContent`) === 'Click again to clear', 'Start over asks for a second click');
  await click0('#restart');
  check(await B(`until(() => !Object.keys(S.actions).length && ordered().filter(b => b.kind === 'p').length === 1 && text(byText('load data')) === 'load data/titanic.csv into df')`), 'Start over restores the starting notebook in both views');
  // and the app's own Reset demo… (⋯ menu) does the same
  await click('Alice', q('#morebtn')); await click('Alice', q('#reset'));
  check(await A(`until(() => document.querySelector('#modal .dlg'))`), 'Reset demo… in the ⋯ menu asks to confirm'); await click('Alice', q('#modal .btns button'));
  check(await B(`ordered().some(b => b.author === 'Bob')`), '… with the tasks still split');
  await ev('location.reload(), 1'); await sleep(1500);
  for (let i = 0; i < 150 && !(await ev(`!!(${up('Alice')} && ${up('Bob')})`)); i++) await sleep(200);
  for (const f of [A, B]) await f(`(${helpers})(); 1`);
  check(await A(`until(() => ordered().filter(b => b.kind === 'p').length === 1 && !Object.keys(S.actions).length)`), 'a reload keeps the reset notebook');
} catch (e) {
  check(false, 'crashed: ' + e.message);
  const shot = await send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
  if (shot?.result) (await import('node:fs')).writeFileSync(`${process.env.TEMP || '/tmp'}/demo-crash.png`, Buffer.from(shot.result.data, 'base64'));
}
console.log(`${nPass}/${nAll} passed`); console.log(ok ? 'ALL PASS' : 'SOME FAILED');
await cleanup(); process.exit(ok ? 0 : 1);
