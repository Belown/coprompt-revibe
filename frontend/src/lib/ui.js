// Toasts and modal dialogs as services, so non-React modules (mechanisms, LLM) can notify and ask.
import { emit } from './bus.js';
import { uid } from './util.js';

export let toasts = [];
export function toast(m, { kind = 'info', ms = kind === 'err' ? 9000 : 4500, action } = {}) {
  const t = { id: uid(), m, kind, action };
  toasts = [...toasts.slice(-2), t]; emit();
  setTimeout(() => dismissToast(t.id), ms);
}
export function dismissToast(id) { if (toasts.some(t => t.id === id)) { toasts = toasts.filter(t => t.id !== id); emit(); } }
export const toastErr = e => e.quiet || toast(e.message ?? e, { kind: 'err' }); // an Error or a message; quiet errors were already shown

// modal queue: one dialog at a time; openModal resolves with {fieldKey: value} on confirm, null on cancel
let queue = [];
const closedHooks = [];
export const currentModal = () => queue[0] || null;
export const isModalOpen = () => queue.length > 0;
export const onModalClosed = f => closedHooks.push(f);
export function openModal(spec) {
  return new Promise(res => { queue = [...queue, { body: [], fields: [], ...spec, id: uid(), res }]; emit(); });
}
export function closeModal(m, value) {
  if (!queue.includes(m)) return;
  queue = queue.filter(x => x !== m); emit(); m.res(value);
  setTimeout(() => closedHooks.forEach(f => f()), 50);
}
// body: string or string[] (paragraphs); returns true / the typed text on confirm, null on cancel
export async function ask(body, { title, input = false, value, placeholder = '', ok = 'OK', cancel = 'Cancel' } = {}) {
  const r = await openModal({ title, body: [].concat(body), fields: input ? [{ key: 'v', value, placeholder }] : [], ok, cancel });
  return r ? (input ? r.v : true) : null;
}
