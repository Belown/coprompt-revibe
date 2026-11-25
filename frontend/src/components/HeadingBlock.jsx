// Heading = a task in the multi-level outline. A whole section can be the source of a link or share (§8).
// Its title is collaborative like a prompt: TipTap on the heading's Y.js fragment, with collaborators' carets.
import { useState, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { Extension } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Collaboration from '@tiptap/extension-collaboration';
import { Placeholder } from '@tiptap/extensions';
import Icon from './Icon.jsx';
import { Dots, Ctl, Grip, Presence } from './bits.jsx';
import { carets, editors } from './PromptInput.jsx';
import { ui, presence } from '../lib/store.js';
import { ME, ucol } from '../lib/util.js';
import { actsOn } from '../lib/model.js';
import { indent } from '../lib/blocks.js';
import { setSource } from '../lib/mechanisms.js';
import { headFrag } from '../lib/ytext.js';

const HeadingKeys = Extension.create({ // Enter leaves the title, Tab / Shift+Tab move the heading in or out a level
  name: 'headingKeys', addOptions: () => ({ bid: null }),
  addKeyboardShortcuts() {
    const id = this.options.bid;
    return { Enter: ({ editor }) => editor.commands.blur(), Tab: () => (indent(id, 1), true), 'Shift-Tab': () => (indent(id, -1), true) };
  },
});

export default function HeadingBlock({ b, dnd, rail }) {
  const id = b.id, [armed, arm] = useState(false);
  const editor = useEditor({
    extensions: [Document.extend({ content: 'paragraph' }), Paragraph, Text, HeadingKeys.configure({ bid: id }),
      Placeholder.configure({ placeholder: 'Heading' }), Collaboration.configure({ fragment: headFrag(id) }), carets()],
    editorProps: { attributes: { class: 'htext', 'aria-label': 'Heading', title: 'Tab / Shift+Tab: move in or out a level' } },
    onFocus: () => presence(id), onBlur: () => presence(null),
  }, [id]);
  useEffect(() => { editors.set(id, editor); return () => { editors.delete(id); }; }, [editor, id]);
  useEffect(() => { if (ui.focus?.id === id && editor) { editor.commands.focus(); ui.focus = null; } });
  const others = Object.entries(ui.PRES).filter(([u, x]) => x === id && u !== ME).map(([u]) => u);
  const cls = ['block', 'hb', others.length && 'here', ui.SOURCE?.b === id && 'is-src', dnd.dragging === id && 'dragging',
    dnd.drop?.id === id && (dnd.drop.after ? 'drop-after' : 'drop-before')].filter(Boolean).join(' ');
  return <div className={cls} data-id={id} data-d={rail['--d']} style={{ '--who': ucol(others[0]), ...rail }} draggable={armed}
    onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); dnd.start(id); }}
    onDragEnd={() => { arm(false); dnd.end(); }}>
    <Grip arm={arm} />
    <EditorContent editor={editor} className="hi" />
    <Dots types={[...new Set(actsOn(id).map(a => a.type))]} />
    <Presence users={others} />
    <Ctl id={id}>
      <button title="Move out a level (Shift+Tab)" aria-label="Move out a level" onClick={() => indent(id, -1)}><Icon name="left" /></button>
      <button title="Move in a level (Tab)" aria-label="Move in a level" onClick={() => indent(id, 1)}><Icon name="right" /></button>
      <button title="Use this whole section as the source (to link or share it)" onClick={() => setSource(id)}><Icon name="node" />source</button>
    </Ctl>
  </div>;
}
