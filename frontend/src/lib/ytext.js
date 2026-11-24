// Prompt text is collaborative (§6.3: a Y.js CRDT, so two people typing in one prompt merge). One Y.Doc per room,
// one XmlFragment 'p:<block id>' per prompt block, bound to its TipTap editor (components/PromptInput.jsx).
// Everything else (mechanisms, wiki, LLM templates, history) keeps working with plain segments,
// [{t: 'text', v}, {t: 'node', id, v}], read with segs() and written with setSegs() / renameNode().
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';

export const ydoc = new Y.Doc();
export const awareness = new Awareness(ydoc); // text cursors and selections (CollaborationCaret)
export const frag = id => ydoc.getXmlFragment('p:' + id);

export function segs(id) {
  const out = [];
  const add = v => { if (!v) return; if (out.at(-1)?.t === 'text') out.at(-1).v += v; else out.push({ t: 'text', v }); };
  frag(id).toArray().forEach((p, i) => {
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

// Rename one node chip in place, so the rest of the prompt (and its formatting) is untouched.
export function renameNode(id, nid, v) {
  for (const p of frag(id).toArray()) for (const c of p.toArray?.() || [])
    if (c instanceof Y.XmlElement && c.nodeName === 'promptNode' && c.getAttribute('id') === nid) c.setAttribute('v', v);
}

// What backend/server.js does for a room: write each prompt block's starting segs once (marked in the 'init' map).
// Used by the local (no server) transport, which plays the server.
export function initTexts(doc, S) {
  const done = doc.getMap('init');
  doc.transact(() => {
    for (const b of Object.values(S.blocks)) if (b?.kind === 'p' && !done.has(b.id)) {
      done.set(b.id, true);
      if (b.segs?.length) doc.getXmlFragment('p:' + b.id).insert(0, [paragraph(b.segs)]);
    }
  });
}

export const b64 = u => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
export const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
