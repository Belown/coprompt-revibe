// Code generation for one prompt block (Fig. 12 add / Fig. 13 edit), code-first prompts, prompt-only versions.
import { S, ui, put, busy, seenNow } from './store.js';
import { ME } from './util.js';
import { text, codeAbove, sharedCtx, snap } from './model.js';
import { T } from './templates.js';
import { llm } from './llm.js';
import { commitCode } from './mechanisms.js';
import { toast, toastErr } from './ui.js';

export async function generate(id) {
  const b = S.blocks[id], p = text(b).trim();
  if (ui.BUSY[id]) return; // already working on this block (here or in the other window)
  if (!p) return toast('Write what the block should do first.');
  busy(id, b.code.trim() ? 'updating code…' : 'generating code…');
  try {
    const shared = sharedCtx(id); // share → heading context applies to new AND edited prompts under that task
    const ctx = codeAbove(id) + (shared ? `\n\n(Context that collaborators shared with this task:)\n${shared}` : '');
    const code = b.code.trim() ? await llm(T.edit(p, b.code, ctx)) : await llm(T.add(p, ctx));
    busy(id, null); // this block is done; downstream link/request checks show their own labels
    S.blocks[id].editor = ME;
    await commitCode(id, code, b.code.trim() ? 'edit prompt' : 'add prompt');
  } catch (e) { toastErr(e.message); } finally { busy(id, null); }
}

// code-first block (§6.3: "initiate a code block and manually input code, pausing midway to generate a prompt block from the code comments")
export async function promptFromCode(id, typed) {
  if (typed != null && typed !== S.blocks[id].code) { S.blocks[id].editor = ME; await commitCode(id, typed, 'edit code'); }
  if (!S.blocks[id].code.trim()) return toast('Write some code (with comments) first.');
  if (ui.BUSY[id]) return;
  busy(id, 'writing the prompt from the code comments…');
  try {
    const r = await llm(T.describe(S.blocks[id].code), true), v = String(r.prompt || '').trim();
    if (!v) throw new Error('The model returned no prompt.');
    const b = S.blocks[id]; b.segs = [{ t: 'text', v }]; b.editor = ME;
    b.hist = [...(b.hist || []), snap(b, 'prompt from code')].slice(-40); seenNow(b); put('blocks', b);
  } catch (e) { toastErr(e.message); } finally { busy(id, null); }
}

// version a prompt edit that did not (yet) regenerate code, so the history view follows the prompt's evolution too
export function snapPrompt(id) {
  const b = S.blocks[id]; if (!b || b.kind !== 'p' || ui.BUSY[id]) return;
  const last = b.hist?.at(-1);
  if (last ? last.segs.map(s => s.v).join('') === text(b) : !text(b).trim()) return;
  b.hist = [...(b.hist || []), snap(b, 'edit prompt text')].slice(-40); seenNow(b); put('blocks', b);
}

export async function restoreVersion(id, v) {
  const b = S.blocks[id]; b.segs = structuredClone(v.segs); b.editor = ME;
  await commitCode(id, v.code, 'restore');
}
