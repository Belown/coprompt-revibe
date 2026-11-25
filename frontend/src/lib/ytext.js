// Everything people type is collaborative (§6.3: a Y.js CRDT, so two people typing in one place merge). One Y.Doc
// per room, holding for each prompt block its prompt, an XmlFragment 'p:<id>' (TipTap, components/PromptInput.jsx),
// and its code, a Y.Text 'c:<id>' (CodeMirror, components/CodeEditor.jsx); for each heading its title, an XmlFragment
// 'h:<id>' (TipTap, components/HeadingBlock.jsx).
// Mechanisms, wiki, LLM templates and history keep working with plain values: a prompt as segments,
// [{t: 'text', v}, {t: 'node', id, v}], read with segs() and written with setSegs() / renameNode(); code and heading
// text as b.code and b.text, which live() turns into accessors of the Y.js text.
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';

export const ydoc = new Y.Doc();
export const awareness = new Awareness(ydoc); // text cursors and selections (CollaborationCaret)
export const frag = id => ydoc.getXmlFragment('p:' + id);
export const codeText = id => ydoc.getText('c:' + id);
export const headFrag = id => ydoc.getXmlFragment('h:' + id);
const plain = f => segsOf(f).map(s => s.v).join('');

export const segs = id => segsOf(frag(id));
function segsOf(f) {
  const out = [];
  const add = v => { if (!v) return; if (out.at(-1)?.t === 'text') out.at(-1).v += v; else out.push({ t: 'text', v }); };
  f.toArray().forEach((p, i) => {
    if (!(p instanceof Y.XmlElement)) return;
    if (i) add(' '); // pasted lines read as one prompt
    for (const c of p.toArray()) {
      if (c instanceof Y.XmlText) c.toDelta().forEach(d => typeof d.insert === 'string' && add(d.insert));
      else if (c.nodeName === 'promptNode') out.push({ t: 'node', id: c.getAttribute('id'), v: c.getAttribute('v') });
    }
  });
  return out;
}

// The Y.js shape y-tiptap gives a TipTap paragraph: text is an XmlText, a node chip an XmlElement 'promptNode'.
// Same function as paragraph() in backend/server.js, which writes a seed's starting text.
export function paragraph(s) {
  const p = new Y.XmlElement('paragraph');
  p.insert(0, s.filter(x => typeof x?.v === 'string' && (x.t === 'node' || x.v)).map(x => {
    if (x.t === 'node') { const n = new Y.XmlElement('promptNode'); n.setAttribute('id', String(x.id)); n.setAttribute('v', x.v); return n; }
    const t = new Y.XmlText(); t.insert(0, x.v); return t;
  }));
  return p;
}

// Replace a prompt's whole text (mechanism rewrites, restore, prompt from code). Formatting is not kept.
export function setSegs(id, s) {
  const f = frag(id);
  ydoc.transact(() => { f.delete(0, f.length); f.insert(0, [paragraph(s)]); });
}

function replaceText(t, v) { if (t.toString() !== v) ydoc.transact(() => { t.delete(0, t.length); t.insert(0, v); }); }
function setHeading(id, v) { const f = headFrag(id); if (plain(f) !== v) ydoc.transact(() => { f.delete(0, f.length); f.insert(0, [paragraph([{ t: 'text', v }])]); }); }

// b.code (prompt block) and b.text (heading) read and write the Y.js text, so every caller sees what is typed live and
// a write (an LLM answer, a restore) merges like typing. Not enumerable: the synced block object no longer carries them.
// Called on every block that enters S (lib/store.js).
export function live(b) {
  const f = b?.kind === 'p' ? 'code' : b?.kind === 'h' ? 'text' : null;
  if (!f || Object.getOwnPropertyDescriptor(b, f)?.get) return b;
  Object.defineProperty(b, f, f === 'code'
    ? { get: () => codeText(b.id).toString(), set: v => replaceText(codeText(b.id), String(v ?? '')), enumerable: false, configurable: true }
    : { get: () => plain(headFrag(b.id)), set: v => setHeading(b.id, String(v ?? '')), enumerable: false, configurable: true });
  return b;
}

// Rename one node chip in place, so the rest of the prompt (and its formatting) is untouched.
export function renameNode(id, nid, v) {
  for (const p of frag(id).toArray()) for (const c of p.toArray?.() || [])
    if (c instanceof Y.XmlElement && c.nodeName === 'promptNode' && c.getAttribute('id') === nid) c.setAttribute('v', v);
}

// What backend/server.js does for a room: write each block's starting prompt, code and heading text once (marked in
// the 'init' map). Used by the local (no server) transport, which plays the server. Same as initTexts() there.
export function initTexts(doc, S) {
  const done = doc.getMap('init'), once = (key, f) => { if (!done.has(key)) { done.set(key, true); f(); } };
  doc.transact(() => {
    for (const b of Object.values(S.blocks)) {
      if (b?.kind === 'p') {
        once(b.id, () => { if (b.segs?.length) doc.getXmlFragment('p:' + b.id).insert(0, [paragraph(b.segs)]); });
        once('c:' + b.id, () => { if (typeof b.code === 'string' && b.code) doc.getText('c:' + b.id).insert(0, b.code); });
      }
      if (b?.kind === 'h') once('h:' + b.id, () => { if (typeof b.text === 'string' && b.text) doc.getXmlFragment('h:' + b.id).insert(0, [paragraph([{ t: 'text', v: b.text }])]); });
    }
  });
}

export const b64 = u => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
export const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
