// The code area of a prompt block (§6.1, execution code block): CodeMirror bound to the block's Y.js text, so two
// people editing the same code merge, and each sees the other's caret and selection (§6). Python highlighting.
import { useEffect, useRef } from 'react';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { python } from '@codemirror/lang-python';
import * as Y from 'yjs';
import { yCollab, yUndoManagerKeymap, ySyncAnnotation } from 'y-codemirror.next';
import { S, presence } from '../lib/store.js';
import { ME } from '../lib/util.js';
import { commitCode } from '../lib/mechanisms.js';
import { ydoc, awareness, codeText } from '../lib/ytext.js';

const views = new Map(); // block id -> its CodeMirror view, for the e2e hook
export const codeViewOf = id => views.get(id);

export default function CodeEditor({ id }) {
  const host = useRef(null);
  useEffect(() => {
    const yt = codeText(id);
    let typed = false; // this user typed here since focusing it (a collaborator's edit arriving meanwhile does not count)
    const caretHere = () => { // the caret this user shares is in this code (one elsewhere belongs to that editor)
      const c = awareness.getLocalState()?.cursor;
      return !!c && Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(c.anchor), ydoc)?.type === yt;
    };
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: yt.toString(),
        extensions: [
          keymap.of([...yUndoManagerKeymap, indentWithTab, ...defaultKeymap]),
          python(), syntaxHighlighting(defaultHighlightStyle), EditorView.lineWrapping,
          placeholder('# code appears here (you can also write it yourself)'),
          EditorView.contentAttributes.of({ 'aria-label': 'Code' }),
          yCollab(yt, awareness),
          EditorView.updateListener.of(u => { if (u.docChanged && u.transactions.some(t => !t.annotation(ySyncAnnotation))) typed = true; }),
          EditorView.domEventHandlers({
            focus: () => { typed = false; presence(id); },
            blur: () => {
              presence(null);
              if (caretHere()) awareness.setLocalStateField('cursor', null); // CodeMirror leaves it; others would see it stay
              // a manual edit is versioned, and checked against links and requests, once: when you leave the code
              if (typed && S.blocks[id]) { typed = false; S.blocks[id].editor = ME; commitCode(id, yt.toString(), 'edit code'); }
            },
          }),
        ],
      }),
    });
    views.set(id, view);
    return () => { views.delete(id); view.destroy(); };
  }, [id]);
  return <div ref={host} className="code" />;
}
