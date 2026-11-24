// The prompt editor (§6.3): TipTap (ProseMirror) bound to this prompt's Y.js fragment, so collaborators typing in
// the same prompt merge. Their text cursors and selections show live (CollaborationCaret); selecting text opens the
// formatting toolbar of Fig. 4a, with Make node; a node chip is an atomic inline node ('promptNode').
import { useEffect, useLayoutEffect } from 'react';
import { useEditor, useEditorState, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { Node, Extension } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import Collaboration, { isChangeOrigin } from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { Placeholder } from '@tiptap/extensions';
import Icon from './Icon.jsx';
import { S, ui, put, presence } from '../lib/store.js';
import { emit } from '../lib/bus.js';
import { ME, ucol, uid } from '../lib/util.js';
import { generate, snapPrompt } from '../lib/codegen.js';
import { ask, toast } from '../lib/ui.js';
import { frag, awareness, renameNode } from '../lib/ytext.js';
import { TYPED, chipEl, decorateChip } from '../lib/promptDom.js';

const editors = new Map(); // block id -> its editor, for the e2e hooks below
export const editorOf = id => editors.get(id);

const PromptNode = Node.create({
  name: 'promptNode', group: 'inline', inline: true, atom: true, selectable: false,
  addOptions: () => ({ bid: null }),
  addAttributes: () => ({ id: { default: null }, v: { default: '' } }),
  parseHTML: () => [{ tag: 'span[data-n]', getAttrs: el => ({ id: uid(), v: el.dataset.v || el.textContent }) }], // a pasted chip is a new node
  renderHTML: ({ node }) => ['span', { class: 'node', 'data-n': node.attrs.id, 'data-v': node.attrs.v }, node.attrs.v],
  renderText: ({ node }) => node.attrs.v,
  addNodeView() { // the chip, with its mechanism dots; ProseMirror ignores what decorateChip changes inside it
    const bid = this.options.bid;
    return ({ node }) => { const dom = chipEl(node.attrs); decorateChip(dom, bid); return { dom, ignoreMutation: () => true }; };
  },
});
const EnterGenerates = Extension.create({
  name: 'enterGenerates', addOptions: () => ({ bid: null }),
  addKeyboardShortcuts() { return { Enter: () => { generate(this.options.bid); return true; } }; },
});

// collaborators' carets and selections; the colour comes from the name here, never from what their client sent
const who = user => String(user?.name ?? '?').slice(0, 40);
const caret = user => {
  const c = document.createElement('span'), l = document.createElement('span');
  c.className = 'ccaret'; c.style.setProperty('--who', ucol(who(user)));
  l.className = 'ccaret-l'; l.textContent = who(user); c.append(l);
  return c;
};
const selection = user => ({ class: 'csel', style: `--who: ${ucol(who(user))}` });

// Make node: the selected phrase (outer spaces trimmed) becomes a chip and the source node
export function makeNode(editor, id) {
  const { state } = editor, { from, to } = state.selection;
  let chip = false; state.doc.nodesBetween(from, to, n => { if (n.type.name === 'promptNode') chip = true; });
  if (from === to || chip) return toast('Select a phrase that has no node in it yet.');
  const t = state.doc.textBetween(from, to), a = from + t.length - t.trimStart().length, z = to - (t.length - t.trimEnd().length);
  if (a >= z) return;
  const nid = uid();
  editor.chain().focus().insertContentAt({ from: a, to: z }, { type: 'promptNode', attrs: { id: nid, v: state.doc.textBetween(a, z) } }).run();
  ui.SOURCE = { b: id, n: nid }; emit();
  toast('Source node set. Now pick a target prompt in the Prompt Wiki →');
}
// e2e hook: select the last occurrence of a word in a prompt and make it a node
export function nodeFromWord(id, word) {
  const ed = editors.get(id); if (!ed) return null;
  let pos = -1; ed.state.doc.descendants((n, p) => { if (n.isText && n.text.includes(word)) pos = p + n.text.lastIndexOf(word); });
  if (pos < 0) return null;
  ed.commands.setTextSelection({ from: pos, to: pos + word.length }); makeNode(ed, id);
  return ui.SOURCE;
}

const FORMATS = [ // [mark, label, command]
  ['bold', 'Bold', 'toggleBold'], ['italic', 'Italic', 'toggleItalic'], ['underline', 'Underline', 'toggleUnderline'],
  ['strike', 'Strikethrough', 'toggleStrike'], ['code', 'Code', 'toggleCode'], ['highlight', 'Highlight', 'toggleHighlight'],
];

export default function PromptInput({ b }) {
  const id = b.id;
  const editor = useEditor({
    extensions: [
      Document.extend({ content: 'paragraph' }), // a prompt is one line: Enter generates code
      StarterKit.configure({ document: false, heading: false, blockquote: false, bulletList: false, orderedList: false, listItem: false,
        listKeymap: false, codeBlock: false, horizontalRule: false, hardBreak: false, link: false, trailingNode: false,
        dropcursor: false, gapcursor: false, undoRedo: false }), // undo comes from Collaboration (per user, Y.js)
      Highlight, PromptNode.configure({ bid: id }), EnterGenerates.configure({ bid: id }),
      Placeholder.configure({ placeholder: 'Describe in plain English what this block should do…' }),
      Collaboration.configure({ fragment: frag(id) }),
      CollaborationCaret.configure({ provider: { awareness }, user: { name: ME }, render: caret, selectionRender: selection }),
    ],
    editorProps: { attributes: { class: 'prompt', 'aria-label': 'Prompt' } },
    onFocus: () => presence(id),
    onBlur: () => {
      presence(null);
      if (!TYPED.delete(id)) return;
      const x = S.blocks[id]; if (x) { x.editor = ME; put('blocks', x); }
      snapPrompt(id);
    },
    onUpdate: ({ transaction }) => { if (!isChangeOrigin(transaction)) TYPED.add(id); }, // typed here, not a collaborator's change
  }, [id]);
  const active = useEditorState({ editor, selector: ({ editor: e }) => Object.fromEntries(FORMATS.map(([m]) => [m, !!e?.isActive(m)])) });
  useEffect(() => { editors.set(id, editor); return () => { editors.delete(id); }; }, [editor, id]);
  useLayoutEffect(() => { editor?.view.dom.querySelectorAll('.node').forEach(c => decorateChip(c, id)); }); // mechanism dots change

  const onClick = e => {
    const c = e.target.closest('.node'); if (!c) return;
    ui.SOURCE = ui.SOURCE?.n === c.dataset.n ? null : { b: id, n: c.dataset.n }; emit();
  };
  const onDoubleClick = async e => { // rename a node (Fig. 7c), then regenerate this block
    const c = e.target.closest('.node'); if (!c) return;
    const v = (await ask('The block is regenerated with the new name; linked blocks follow.',
      { title: `Rename “${c.dataset.v}”`, input: true, value: c.dataset.v, ok: 'Rename' }))?.trim();
    if (!v || v === c.dataset.v) return;
    renameNode(id, c.dataset.n, v);
    const x = S.blocks[id]; x.editor = ME; put('blocks', x); generate(id);
  };
  return <>
    <EditorContent editor={editor} className="pi" onClick={onClick} onDoubleClick={onDoubleClick} />
    {/* TipTap's own shouldShow: a non-empty text selection while this prompt has focus */}
    <BubbleMenu editor={editor} className="bubble">
      {FORMATS.map(([m, label, cmd]) => <button key={m} className={'fmt fmt-' + m} aria-label={label} title={label} aria-pressed={!!active?.[m]}
        onMouseDown={e => e.preventDefault()} onClick={() => editor.chain().focus()[cmd]().run()}>
        {m === 'highlight' ? <Icon name="highlight" /> : m === 'code' ? '</>' : label[0]}</button>)}
      <span className="bsep" />
      <button className="mk" onMouseDown={e => e.preventDefault()} onClick={() => makeNode(editor, id)}><Icon name="node" />Make node</button>
    </BubbleMenu>
  </>;
}
