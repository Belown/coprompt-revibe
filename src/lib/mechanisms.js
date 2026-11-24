// The four mechanisms of §6.2 (refer, request, share, link) and the D2 automation behind them.
import { S, ui, put, busy, seenNow } from './store.js';
import { emit } from './bus.js';
import { ME, MECH, uid, trimWs } from './util.js';
import { text, label, live, actsOn, members, inScope, provider, prevCode, snap, codeAbove } from './model.js';
import { T, applyPrompt } from './templates.js';
import { llm } from './llm.js';
import { ask, toast, toastErr, isModalOpen } from './ui.js';

export async function commitCode(id, code, action, by = ME, visited = new Set()) {
  const b = S.blocks[id]; b.code = code;
  b.hist = [...(b.hist || []), snap(b, action, by)].slice(-40);
  if (b.author === ME || !MECH[action]) seenNow(b); // automatic rewrites of others' blocks stay highlighted for them
  put('blocks', b);
  await afterCodeChange(id, visited);
}

// D2: a code change may fulfil requests and must propagate along links. Both checks are batched (Fig. 14–15 take lists).
async function afterCodeChange(id, visited) {
  if (visited.has(id)) return; visited.add(id);
  const acts = Object.values(S.actions).filter(live);
  // open requests: any change inside the target; fulfilled ones keep tracking the block that fulfilled them (Fig. 5c)
  const reqs = acts.filter(a => a.type === 'request' && a.src.b !== id &&
    ((a.status === 'open' && inScope(a.tgt, id)) || (a.status === 'fulfilled' && (a.fulfilledBy ?? a.tgt.b) === id)));
  try { if (reqs.length) await checkRequests(reqs.map(a => a.id), id, visited); } catch (e) { toastErr(e.message); }
  const pairs = [], taken = new Set();
  for (const a of acts) if (a.type === 'link') for (const [mine, other] of [[a.src, a.tgt], [a.tgt, a.src]]) {
    if (!inScope(mine, id)) continue; // a heading end covers its whole section (§8: links between headings)
    for (const m of members(other.b)) {
      if (m === id || visited.has(m) || taken.has(m) || !S.blocks[m].code.trim()) continue;
      taken.add(m); pairs.push({ a, mine, other, m });
    }
  }
  try { if (pairs.length) await syncLinks(pairs, id, visited); } catch (e) { toastErr(e.message); }
}

async function checkRequests(aids, provId, visited) {
  const p = S.blocks[provId], acts = aids.map(x => S.actions[x]);
  acts.forEach(a => busy(a.src.b, `checking request on “${text(p)}”…`));
  let res;
  try {
    res = [].concat(await llm(T.request({ completion: codeAbove(provId).slice(-3000), requests: acts.map((a, i) => ({ id: a.id, index: i + 1,
      prompt: text(p), code: p.code, supplementary_info: a.msg || text(S.blocks[a.src.b]) })) }), true));
  } finally { acts.forEach(a => busy(a.src.b, null)); }
  for (const [i, a] of acts.entries()) {
    const r = res.find(x => x?.id === a.id) || res.find(x => x?.index === i + 1), was = S.actions[a.id].status;
    if (!r?.fulfilled) {
      if (was === 'fulfilled') {
        const cur = S.actions[a.id]; cur.status = 'open'; put('actions', cur);
        toast(`“${text(p)}” changed and no longer fulfils ${a.by}’s request, so it is open again.`);
      }
      continue;
    }
    try { await regen(a.src.b, a.src.n, provId, a, visited); } catch (e) { toastErr(e.message); continue; }
    const cur = S.actions[a.id]; cur.status = 'fulfilled'; cur.fulfilledBy = provId; put('actions', cur);
    toast(was === 'fulfilled' ? `“${text(p)}” changed: “${text(S.blocks[a.src.b])}” regenerated again (request still tracked).`
      : `Request fulfilled by “${text(p)}”: “${text(S.blocks[a.src.b])}” regenerated.`);
  }
}

async function syncLinks(pairs, changedId, visited) {
  const A = S.blocks[changedId];
  const phrase = (ref, bid) => ref.b === bid ? label(ref) : `(whole section “${label(ref)}”)`;
  const pid = p => `${p.a.id}:${p.m}`;
  pairs.forEach(p => busy(p.m, 'link: checking dependency…'));
  let res;
  try {
    res = [].concat(await llm(T.link(pairs.map((p, i) => ({ id: pid(p), index: i + 1, ...(p.a.msg && { note: p.a.msg }),
      Code_Segment_A: { prompt: text(A), linked_phrase: phrase(p.mine, changedId), previous_code: prevCode(A), code: A.code },
      Code_Segment_B: { prompt: text(S.blocks[p.m]), linked_phrase: phrase(p.other, p.m), code: S.blocks[p.m].code } }))), true));
  } finally { pairs.forEach(p => busy(p.m, null)); }
  for (const [i, p] of pairs.entries()) {
    const r = res.find(x => x?.id === pid(p)) || res.find(x => x?.index === i + 1);
    if (!r?.updated || !r.updated_code) continue;
    const nb = S.blocks[p.m], seg = p.other.b === p.m && p.other.n && nb.segs.find(s => s.id === p.other.n);
    if (seg && r.updated_phrase) seg.v = r.updated_phrase;
    await commitCode(p.m, r.updated_code, 'link', p.a.by, visited);
    toast(`Link: “${text(nb)}” updated automatically.`);
  }
}

// refer / share / fulfilled request: rebuild the consumer block with a provider prompt (or section) as context.
// Refer and request rewrite the whole prompt (Fig. 4c, 5c); share only updates the code (Fig. 6c).
async function regen(consumerId, nodeId, providerId, a, visited = new Set()) {
  const c = S.blocks[consumerId], codeOnly = a.type === 'share';
  busy(consumerId, `${a.type}: regenerating ${codeOnly ? 'code' : 'prompt + code'}…`);
  try {
    const node = nodeId && c.segs.find(s => s.id === nodeId);
    const r = await llm(T.regen(c, node, provider(providerId), a.msg, codeAbove(consumerId), codeOnly), true);
    busy(consumerId, null);
    const nc = S.blocks[consumerId];
    if (!codeOnly && !(r.prompt && applyPrompt(nc, r.prompt))) { // fall back to renaming just the node
      const nn = nodeId && nc.segs.find(s => s.id === nodeId); if (nn && r.node_text) nn.v = r.node_text;
    }
    await commitCode(consumerId, r.code, a.type, a.by, visited);
  } finally { busy(consumerId, null); }
}

// create a mechanism from the current source node to a target picked in the wiki (rowEl: the wiki row, for a selected phrase)
export async function mech(type, tgtB, rowEl) {
  const src = ui.SOURCE;
  if (!src) return toast('Select a phrase in one of your prompts and choose Make node first (or use a whole prompt or section).');
  if (src.b === tgtB) return toast('Pick a target in a different prompt.');
  const sb = S.blocks[src.b], tb = S.blocks[tgtB];
  if (sb.kind === 'h' && (type === 'refer' || type === 'request')) return toast('Refer and request rebuild one prompt: use a node or a whole prompt as the source.');
  if (members(tgtB).includes(src.b) || members(src.b).includes(tgtB)) return toast('The source and the target overlap; pick a target outside the source’s section.');
  // target node: text selected in the wiki row → new node; else a clicked wiki node; else whole prompt/heading
  let n = null; const sel = getSelection();
  if (sel.rangeCount && !sel.isCollapsed && rowEl.contains(sel.anchorNode)) n = makeTargetNode(tgtB, sel);
  else if (ui.TGTNODE?.b === tgtB) n = ui.TGTNODE.n;
  const tgt = { b: tgtB, n }, who = tb.author === ME ? 'your' : `${tb.author}’s`, what = tb.kind === 'h' ? 'task' : 'prompt';
  // every mechanism carries an optional message (§6.2: "(3) additional messages"); for request it states the expected result
  const [title, body, placeholder, ok] = {
    refer: [`Refer to ${who} ${what}`, `Your prompt “${text(sb)}” is rewritten, with its code, from “${label(tgt)}” (prompt, code and execution result).`,
      'Optional note for the model, e.g. use the encoded frame', 'Refer'],
    request: [`Request to ${tb.author}`, `Ask ${tb.author} to finish “${label(tgt)}”. Your prompt “${text(sb)}” is regenerated once it is done, and again whenever it changes.`,
      'What do you need? e.g. fill missing values instead of dropping the columns', 'Send request'],
    share: [`Share with ${tb.author}`, `${tb.author} gets a pop-up offering “${label(src)}” for “${label(tgt)}”.`, `Optional note for ${tb.author}`, 'Share'],
    link: [`Link to ${who} ${what}`, `“${label(src)}” and “${label(tgt)}” stay in sync: when either side’s code changes, the other is checked and updated.`,
      'Optional: why they belong together', 'Link'],
  }[type];
  const msg = await ask(body, { title, input: true, placeholder, ok });
  if (msg == null) return;
  const a = { id: uid(), type, src, tgt, by: ME, owner: tb.author, msg: msg.trim(), ts: Date.now(),
    status: type === 'refer' ? 'done' : type === 'link' ? 'active' : 'open', seen: [ME] };
  ui.SOURCE = ui.TGTNODE = null;
  put('actions', a);
  if (type === 'refer') try { await regen(a.src.b, a.src.n, a.tgt.b, a); } catch (e) { toastErr(e.message); }
  if (type === 'link') toast('Linked. Changing either side now updates the other. Click the link dot to unlink.');
  if (type === 'share') toast(`Shared. Waiting for ${tb.author} to accept.`);
  if (type === 'request') toast(`Request sent to ${tb.author}. Your prompt updates when it is fulfilled.`);
}

export function setSource(id) { // whole prompt, or a whole section (heading), as the source node
  ui.SOURCE = ui.SOURCE?.b === id && !ui.SOURCE.n ? null : { b: id, n: null }; ui.TGTNODE = null; emit();
  if (ui.SOURCE) toast(`Source set to the whole ${S.blocks[id].kind === 'h' ? 'section' : 'prompt'}. Now pick a target in the Prompt Wiki →`);
}

function makeTargetNode(bid, sel) { // turn a phrase selected in a wiki row into a target node
  const span = sel.anchorNode.parentElement?.closest('[data-si]');
  if (!span || span !== sel.focusNode.parentElement?.closest('[data-si]')) return null;
  const b = S.blocks[bid], si = +span.dataset.si, v = b.segs[si].v;
  const [x, y] = trimWs(v, ...[sel.anchorOffset, sel.focusOffset].sort((p, q) => p - q));
  if (x === y) return null;
  const id = uid();
  b.segs.splice(si, 1, { t: 'text', v: v.slice(0, x) }, { t: 'node', id, v: v.slice(x, y) }, { t: 'text', v: v.slice(y) });
  b.segs = b.segs.filter(s => s.t === 'node' || s.v);
  sel.removeAllRanges(); put('blocks', b);
  return id;
}

// share pop-ups, one at a time; also shown when the owner comes back online (§5, asynchronous case)
const shownShare = new Set();
export async function checkShares() {
  if (isModalOpen()) return;
  const a = Object.values(S.actions).find(a => a.type === 'share' && a.status === 'open' && a.owner === ME && !shownShare.has(a.id));
  if (!a) return; shownShare.add(a.id);
  const into = S.blocks[a.tgt.b]?.kind === 'h';
  const ok = await ask([`From “${text(S.blocks[a.src.b])}” into your ${into ? 'task' : 'prompt'} “${label(a.tgt)}”.`,
    ...(a.msg ? [`Note from ${a.by}: ${a.msg}`] : []),
    into ? 'Accepting attaches it as context for prompts under this task.' : 'Accepting regenerates your block’s code with it.'],
    { title: `${a.by} shared “${label(a.src)}” with you`, ok: 'Accept', cancel: 'Decline' });
  const cur = S.actions[a.id]; cur.status = ok ? 'accepted' : 'declined'; cur.seen = [...new Set([...cur.seen, ME])];
  put('actions', cur);
  if (!ok) return;
  const tb = S.blocks[cur.tgt.b];
  if (tb.kind === 'h') {
    tb.ctx = [...(tb.ctx || []).filter(c => (c.b ?? c) !== cur.src.b), { b: cur.src.b, msg: cur.msg, by: cur.by }]; put('blocks', tb);
    toast('Context attached to the task; prompts under it now use it.');
  } else try { await regen(tb.id, cur.tgt.n, cur.src.b, cur); } catch (e) { toastErr(e.message); }
}

export function setStatus(aid, status) { const a = S.actions[aid]; a.status = status; put('actions', a); }
export function markActionSeen(aid) { const a = S.actions[aid]; if (!a.seen.includes(ME)) { a.seen.push(ME); put('actions', a); } }
// unlink from the link icon (§5: "unlink the nodes by de-highlighting the link icon"); n undefined = every link on the block
export async function unlinkAt(id, n) {
  const ls = actsOn(id, n).filter(a => a.type === 'link'); if (!ls.length) return;
  const other = a => label(a.src.b === id && (n === undefined || a.src.n === n) ? a.tgt : a.src);
  const what = n ? label({ b: id, n }) : text(S.blocks[id]);
  if (!(await ask(`“${what}” stops syncing with ${ls.map(a => `“${other(a)}”`).join(', ')}.`, { title: 'Unlink?', ok: 'Unlink' }))) return;
  ls.forEach(a => setStatus(a.id, 'unlinked'));
  toast('Unlinked.');
}
