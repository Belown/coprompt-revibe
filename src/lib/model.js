// Read-only views over the notebook state.
import { S } from './store.js';
import { ME } from './util.js';

export const ordered = () => Object.values(S.blocks).filter(b => !b.del).sort((a, b) => a.pos - b.pos);
export const text = b => b.kind === 'h' ? b.text : b.segs.map(s => s.v).join('');
export const label = ref => { const b = S.blocks[ref.b]; if (!b) return '?'; const s = ref.n && b.segs?.find(s => s.id === ref.n); return s ? s.v : text(b); };
// actions on deleted blocks, unlinked links and closed requests go quiet
export const live = a => a.status !== 'unlinked' && a.status !== 'closed' && !S.blocks[a.src.b]?.del && !S.blocks[a.tgt.b]?.del;
export const actsOn = (b, n) => Object.values(S.actions).filter(a => live(a) &&
  ((a.src.b === b && (n === undefined || a.src.n === n)) || (a.tgt.b === b && (n === undefined || a.tgt.n === n))));
export const snap = (b, action, by = ME) => ({ ts: Date.now(), by, action, segs: structuredClone(b.segs), code: b.code });
export const prevCode = b => [...(b.hist || [])].reverse().find(v => v.code !== b.code)?.code ?? ''; // skips prompt-only versions

export function ancestors(id) { // headings enclosing a block
  const st = [];
  for (const b of ordered()) {
    if (b.id === id) return st.map(x => x.id);
    if (b.kind === 'h') { while (st.length && st.at(-1).level >= b.level) st.pop(); st.push(b); }
  }
  return [];
}
export function members(bid) { // prompt blocks a reference covers: the prompt itself, or every prompt in a heading's section
  const b = S.blocks[bid]; if (!b || b.del) return [];
  if (b.kind === 'p') return [bid];
  const list = ordered(), out = [];
  for (const x of list.slice(list.findIndex(x => x.id === bid) + 1)) { if (x.kind === 'h' && x.level <= b.level) break; if (x.kind === 'p') out.push(x.id); }
  return out;
}
export const inScope = (ref, id) => members(ref.b).includes(id);
export function provider(bid) { // what a collaborator's prompt (or whole section) offers as context
  const b = S.blocks[bid], res = p => p.out?.text || p.out?.err || '';
  if (b.kind === 'p') return { author: b.author, prompt: text(b), code: b.code, out: res(b) };
  const ps = members(bid).map(id => S.blocks[id]);
  return { author: b.author, prompt: `section “${b.text}”: ${ps.map(p => text(p)).join('; ') || '(no prompts yet)'}`,
    code: ps.filter(p => p.code.trim()).map(p => `# ${text(p)}\n${p.code}`).join('\n\n'), out: ps.map(res).filter(Boolean).join('\n') };
}
export function codeAbove(id) {
  const out = [];
  for (const b of ordered()) { if (b.id === id) break; if (b.kind === 'p' && b.code.trim()) out.push(`# [${b.author}] ${text(b)}\n${b.code}`); }
  return out.join('\n\n') || '(none)';
}
export const outline = () => ordered().map(b => b.kind === 'h' ? `${'#'.repeat(b.level)} ${b.text} [${b.author}]` : `- prompt [${b.author}]: ${text(b)}`).join('\n');
export function sharedCtx(id) { // context shared to an enclosing heading (share → heading)
  return ancestors(id).flatMap(hid => S.blocks[hid].ctx || []).map(c => typeof c === 'string' ? { b: c } : c)
    .filter(c => S.blocks[c.b] && !S.blocks[c.b].del)
    .map(c => { const p = provider(c.b); return `Shared by ${p.author}${c.msg ? ` (note: ${c.msg})` : ''} — ${p.prompt}\n${p.code}`; }).join('\n\n');
}
