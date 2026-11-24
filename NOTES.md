# CoPrompt revibe

A reimplementation of *CoPrompt: Supporting Prompt Sharing and Referring in Collaborative Natural Language Programming* (Feng, Yen et al., CHI '24), built from the paper alone.

## Run it

A React app (Vite). Needs Node 20+.

```
cd coprompt-revibe
npm install
npm run dev          # http://localhost:5173/?user=Alice
```

1. Open `http://localhost:5173/?user=Alice`, then click **Open as Bob** to get a second window. Put the two windows side by side. The windows sync with each other through `BroadcastChannel`.
2. Click **API key** and paste a DeepSeek key. It is stored in localStorage and shared by both windows. The default model is `deepseek-flash` (thinking disabled, for speed). In the same dialog you can switch to `deepseek-v4-pro`, or enter any `claude-…` model name together with an Anthropic key.
3. The first load fetches Pyodide, pandas, sklearn and matplotlib from the CDN, which takes about 20–40 s. Wait until the header says "Python: ready".
4. **Reset demo** restores the scenario in both windows.

The page needs an internet connection, for the CDN and the API.

## Deploy to GitHub Pages

The build is fully static (no backend). `npm run build` writes `dist/` with relative URLs, so it works from any folder. The workflow in `.github/workflows/pages.yml` builds and publishes it on every push to `main`: set **Settings → Pages → Source** to **GitHub Actions**, push, then open `https://<you>.github.io/<repo>/?user=Alice`.

- **Never commit an API key.** Each viewer pastes their own in **API key**. It stays in that browser's localStorage and is sent only to the provider. DeepSeek and Anthropic both accept browser calls from `github.io`.
- **Collaboration is still same-browser only.** BroadcastChannel connects windows of one browser on one machine, which is fine for a projector demo. Real multi-device collaboration needs a hosted sync service, which GitHub Pages cannot run itself. The paper used Hocuspocus + Firebase; Firebase or a Y.js provider would be the options.

## Code structure

```
src/
  main.jsx, App.jsx        entry; App wires global listeners and the window.cp test hook
  lib/                     no React in here: state and logic
    bus.js                 change counter; React subscribes with useSyncExternalStore
    store.js               shared notebook S, BroadcastChannel sync, presence/busy, "seen" record, seed/reset
    model.js               read-only views: ordered, text, label, members (heading → section), provider, codeAbove, …
    templates.js           Fig. 12–15 templates (+ Fig. 14–15 few-shot examples) and our refer/share/explain/describe ones
    llm.js                 DeepSeek / Anthropic client, settings dialog
    mechanisms.js          refer, request, share, link; batched request/link checks after every code change
    codegen.js             generate (add/edit), prompt from code, prompt-only versions, restore
    blocks.js              add / move / delete blocks, heading level
    promptDom.js           the contenteditable prompt with atomic node chips; flash / jump
    python.js, pyWorker.js Pyodide in a Web Worker
    ui.js                  toast and modal services (usable outside React)
  components/              one component per paper element
    Editor, PromptBlock, PromptInput, HeadingBlock     block editor (Fig. 3a)
    Wiki                                                Prompt Wiki (Fig. 3b)
    Messages                                            message panel (Fig. 3c)
    panels/ExplainPanel, HistoryPanel, CommentsPanel   Fig. 3d, Fig. 3e, annotation
    Header, Overlays (modal, toasts, Make node), bits (avatar, dots, chips, controls), Icon
```

The library owns the state, and React re-renders on every change. Two places deliberately bypass React: the prompt contenteditable (so a collaborator's update never moves your caret) and the code textarea (uncontrolled, for the same reason).

## Demo script (Fig. 2 scenario, with the paper's own user-study dataset, Titanic)

| Step | Who | Action | Paper figure |
|---|---|---|---|
| 0 | Alice | Show the wiki. Fold sections and click a row to jump to it. Run the seeded "load data" block. | Fig. 3 a–c |
| 1 | Alice | Hover the heading *1. Missing values*, click **+ prompt**, type `drop columns with missing values in df` and press Enter (or click **Generate code**). Click **Run**. | |
| 2 | Alice | Under *2. Encode*, write `encode categorical features in df and store the result as df_encoded`, then Enter and Run. Naming a new variable matters for step 3. | |
| 3 | Bob | Under *3. Feature transformation*, write `calculate the skewness of all features in df`. Double-click `df`, click **Make node**, then hover Alice's encode prompt in the wiki and click **refer** (the note is optional). The prompt is rewritten around `df_encoded` and the code is rebuilt. | Fig. 4 |
| 4 | Bob | Under *4. Correlation*, write `plot the correlation matrix of df as a heatmap`. Make a node from `df`, then click **request** on Alice's *missing values* prompt and type "fill missing values instead of dropping the columns". | Fig. 5 a–b |
| 5 | Alice | Notice the red dot in Messages. Change the prompt to `fill missing values in df without dropping any rows or columns` and press Enter. The LLM checks the request and Bob's block regenerates (toast + "fulfilled"). The request stays tracked: Alice's next change regenerates Bob's block again. A vaguer prompt often produces a trailing `dropna()`, and then the check (correctly) says *not fulfilled*. | Fig. 5 c |
| 6 | Alice → Bob | Alice adds `remove outliers of df` under *5*. Bob makes a node from `skewness` in his prompt and clicks **share** on it. Alice gets a pop-up with Bob's note; accepting regenerates her code so it only filters features with high skew. | Fig. 6 |
| 7 | Alice | Make a node from `df` in the missing-values prompt. Click the `df` chip in the encode row of the wiki (target), then **link**. Append ` and store the result as df_filled` to the missing-values prompt and press Enter: the encode block switches to `df_filled` in both prompt and code. To rename later, make `df_filled` a node and **double-click the chip**. To stop the sync, click the purple link dot on the node, or **Unlink** in Messages. | Fig. 7 |
| 8 | either | Click the lightbulb (Explain) on a block for the explanation view (hover a step to trace prompt phrases to code lines). Click the clock (History): pick a version to see the diff, then restore it. Click the speech bubble to leave a comment for the other person. | Fig. 3 d–e |
| 9 | Bob | Hover the heading *3. Feature transformation*, click **source**, then **link** on Alice's heading *2. Encode*: any code change in section 2 is now checked against every block in section 3 (§8, "links between headings"). | |
| 10 | Alice | Click **Code block**, type code with a comment (`# survival rate by class` …), click **Prompt from code**: the prompt is written from the comments (§6.3). | |
| 11 | Bob | Close Bob's window, let Alice change one of Bob's blocks, reopen it: the block is highlighted ("Updated by Alice") and a notice says what changed while Bob was away (§5). | |

## What was reproduced

- A block editor with headings and prompt blocks, where each prompt block has code underneath, Run and Reset. Pressing Enter generates code: the *add* template is used when the block has no code, and the *edit* template when it does. Both templates are transcribed from Fig. 12–13.
- The Prompt Wiki: a multi-level, foldable outline that shows author badges, action dots and comment counts, with click-to-navigate.
- The Message panel: actions in chronological order, with unprocessed actions pinned at the top with a dot, and From/To links that jump to the block and pulse the node.
- Nodes: you select a phrase and it becomes an atomic chip, which is the source node. The ◎ button makes the **whole prompt** the source, and **source** on a heading makes a **whole section** the source. In the wiki, the target can be a selected phrase, a clicked chip, the whole prompt, or a heading (all four mechanisms).
- All four mechanisms. Each asks for an optional message (§6.2: "(3) additional messages"); for request, the message is the expected result.
  - **Refer** rewrites the requester's whole prompt (keeping its nodes) and code from the target's prompt, code and execution result (Fig. 4c). A heading target refers to the whole section.
  - **Request** is queued. Code changes under the target are checked with the Fig. 15 template, batched into one call per change. When the check passes, the requester's prompt and code are regenerated. The request stays tracked: later changes to the fulfilling block regenerate the requester again (Fig. 5c), and if a change breaks it, it goes back to *open*. The requester can **Stop tracking**.
  - **Share** shows a pop-up to the owner, with the note. Accepting regenerates the block's code (Fig. 6c), or attaches the context to a heading. That context is then used for new *and* edited prompts under it.
  - **Link** checks both directions with the Fig. 14 template on every code change, batched into one call, and propagates updates. A heading end covers its whole section. Click the link dot to unlink.
- Fig. 14 and Fig. 15 include their few-shot examples, as §6.3 says ("few-shot learning and Chain-of-Thought").
- Code-first blocks: write code (with comments) in a **Code block**, then **Prompt from code** (§6.3).
- The explanation view; a history view with a diff and restore, which also records prompt edits that did not regenerate code; and annotation: a comment thread per block (§6.2, the speech-bubble button of Fig. 3).
- Presence (which block a collaborator is in) and the "offline" case: a share sent while the other window is closed pops up when it is opened again, and blocks changed while you were away stay highlighted until you click them (§5).
- Drag handles to reorder blocks (Fig. 3).

## Where this version diverges (and why)

| Paper | Revibe | Why |
|---|---|---|
| GPT-4 via OpenAI | DeepSeek (`deepseek-flash`, OpenAI-compatible API; Claude optional), called directly from the browser | The original model is a moving target anyway. Using the same templates keeps the comparison fair-ish. |
| Next.js + React + TypeScript, LLM calls through a server-side route | Vite + React, plain JavaScript, LLM calls from the browser | No server is needed (each viewer brings their own key). JavaScript kept the port from the single-file prototype small. |
| TipTap/ProseMirror + Y.js CRDT + Hocuspocus server + Firebase RTDB/Firestore | `BroadcastChannel` + localStorage, with per-object last-writer-wins | No server is needed for a classroom demo. **It only works for windows in one browser on one machine.** Concurrent typing in the *same* prompt is not merged. |
| Rich-text toolbar (Fig. 3a: bold, highlight, …) | Plain contenteditable; nodes via **Make node** | Formatting is not part of any mechanism. |
| Real-time cursors and text selections | Only "✎ Bob" on the block he is focused in | Cursor rendering inside contenteditable is a project of its own. |
| Pyodide in a Web Worker | Also a Web Worker, but **Run re-executes every block above in a fresh namespace** | This is deterministic and avoids stale or partial kernel state, which the paper never specifies. |
| Server-side logging (Firestore) | None | Logging is not part of the interaction. |
| Icon-only mechanism buttons | Coloured word pills (icon + word: refer, request, share, link) | Easier for the audience to read. |
| Fig. 15 request output = `{id, index, fulfilled}`, with the chain-of-thought as prose *before* the JSON in its example | A `reasoning` field before `fulfilled`, inside the JSON; the example's reasoning sentences moved into that field | Same chain-of-thought, but the reply stays parseable JSON. |
| Fig. 14 link input = current code of both segments | Adds the linked phrases, A's `previous_code`, the user's note, and the sentence "the user linked them because they denote the same value" (taken from §6.2.5) | Without these, the check never propagated a rename (see findings). |
| Fig. 14's few-shot example | Rewritten to be consistent: A's old and new code, and only B updated | In the paper the example's input shows A *before* the change, its reasoning says A was changed, and `updated_code` repeats A. |
| Node text edited in place (Fig. 7c) | Nodes are atomic chips; **double-click a chip to rename it**, which also regenerates the block | Renaming an atomic chip needed a separate interaction. |

## Underspecified details (decisions I had to make)

1. **No templates are given for refer, share, explain or prompt-from-code.** The paper only provides add, edit, link and request (Fig. 12–15). How a referred prompt gets *rewritten* is a big gap: in Fig. 4c "using the above data" becomes "in the encoded df_encode", and nothing says how. I send the prompt with its nodes marked as `[[k|text]]` and ask for a minimally rewritten prompt that keeps every marker. If a marker gets lost, I fall back to renaming only the node. Share rewrites only the code, as in Fig. 6c.
2. **Is refer one-shot or live?** Is it re-applied when the referred prompt changes later? The paper says it "instantly" regenerates. I made it one-shot, because link (and request) are the live mechanisms.
3. **Link direction.** The text says links update "when one side is updated", but Fig. 7 talks about "source → target". I made links bidirectional. That needed a cycle guard, because A→B→A loops otherwise.
4. **Which client runs the detection?** Request fulfilment and link checks are LLM calls triggered by *someone's* edit. I run them in the window that made the edit. As a result, the editor's API key pays, and the requester's block changes without the requester doing anything.
5. **What counts as a code change?** I use generate, a manual code edit (on blur), a mechanism update, and restore. Prompt-only edits are stored in the history but do not trigger checks until they are regenerated.
6. **Mechanisms on headings.** These are mentioned only in the *results* section (§8.3.1, "request tasks at higher-level headings"; "links between headings"). For a request, any code change under that heading is a candidate fulfilment. For a link, a heading end stands for every prompt in its section. A section as the *source* only allows link and share, because refer and request rebuild one prompt.
7. **"Unprocessed" in the message panel.** For request and share this means still open. For refer and link, which need no reply, I count them as unread until the user clicks the message.
8. **Fig. 12 says "no comments", but Fig. 3 shows commented code.** I followed the template.
9. **Shared, or per-user, kernel?** The paper says the Python and OpenAI "kernels do not overlap", but not whether collaborators share execution state. See the Run divergence above.
10. **The coloured dots at the top right of every block (Fig. 3–7)** are never explained. I used them as action-type dots.
11. **Version granularity for history.** I store a version on every code change, and when you leave a prompt whose text changed without regenerating; not on every keystroke.
12. **When does a request end?** The paper says the requester's block updates "whenever" the collaborator's work changes (§5, Fig. 5c), but also that requests get "resolved". A fulfilled request keeps tracking the block that fulfilled it. It reopens if a later change breaks it, and stops only when the requester clicks **Stop tracking**.
13. **What counts as "modifications made" while offline (§5)?** Any new version of a prompt block that the user did not make in their own window, or that a mechanism made automatically. It stays highlighted until the user clicks the block.

## What resisted reimplementation / what the paper made look easy

- **Turning a selection into a node inside contenteditable.** It has to be an atomic chip, and remote updates must not destroy the cursor of the person typing. A focused prompt takes remote changes unless you have typing that hasn't been saved yet (300 ms debounce). Two people typing in the *same* prompt at the same moment is still last-writer-wins. TipTap + Y.js hide this whole problem in the paper. In React, the prompt stays an uncontrolled element for this reason.
- **"Automatic" synchronisation means an LLM call on every code change, for every link and open request.** Batching (one request call and one link call per change, as Fig. 14–15's list inputs suggest) helps, but cascades through chained links still add a call per hop. The paper presents this as a lightweight background check.
- **Fulfilment detection is an LLM yes/no judgement** (Fig. 15). False positives silently rewrite a collaborator's code, and borderline cases flip between runs (see findings). It connects to P12's "slight loss of control". Keeping requests live after fulfilment makes this matter more, which is why **Stop tracking** exists.
- **A bug in my own build:** two windows that start at the same time each seeded their own notebook, which duplicated every block. Real-time collaboration has many of these first-load and ordering edge cases, and the paper does not mention any.
- **Scope-creep temptation:** the agent wanted to add a mock-LLM mode and a multi-user server. I kept it to what the paper claims.

## Findings from testing with a real model (DeepSeek `deepseek-flash`, 2026-11-09)

- **Request verdicts flip on borderline code.** Alice's code filled the NaNs but ended with `df = df.dropna()`. With the paper's Fig. 15 output format, the verdict was *not fulfilled*. With a reasoning field it said *fulfilled* once, then *not fulfilled* in 4 of 5 repeats. The judge is strict and defensible but not deterministic: the same edit can or cannot trigger the automatic rewrite of a collaborator's block.
- **The link check needs to know what changed.** Fig. 14 only shows each segment's current code. When Alice moved her result into a new variable (`df_filled`), the check answered "no update needed" in 3 of 3 runs ("A only creates a new variable and does not modify df"). Adding A's previous code made it correct in 5 of 5. The paper never says what the link check sees.
- **Which phrase you link matters, and the UI gives no hint.** Linking the *input* `df` of "encode … in df and store as df_encoded" to Bob's `df` correctly produced nothing to sync. Fig. 7 links the *output* name.
- **Refer only rewrote the node if the collaborator introduced a new variable** (seen with the earlier node-only refer; refer now rewrites the whole prompt). With in-place `df` code the node stayed `df`. With `df_encoded` it became `df_encoded`, as in Fig. 4c.
- **Implicit dependencies break silently.** Once Alice's steps stopped changing `df` in place, every block that still read `df` failed ("could not convert string to float"). Links only carry changes along explicit edges, so Bob had to re-refer by hand. This is the paper's "procedural dependency" problem, only partly solved (section links now cover a whole subsection at once).
- **Latency:** 1–2 s per DeepSeek call. Every code change adds a request call and a link call when they apply, and cascades took about 3 s. That is fast, but not the "instant" the paper describes.
- **Platform details found by testing in real Chrome:** double-clicking a word on Windows also selects the trailing space, so nodes swallowed it (now trimmed). While Run executed Python on the main thread, the page froze and clicks landed in the wrong place. Python now runs in a Web Worker, as in the paper.

## Verification

- **Real Chrome, two tabs (Alice/Bob), DeepSeek** (single-file version, before the React port): every feature was exercised through the UI. That covers generate (add/edit), Run chaining with errors, plots and seaborn, sync and presence, wiki fold and jump, the message panel, history diff and restore, heading levels, delete, reset, and all four mechanisms including the share-while-offline pop-up and link rename propagation.
- **Two-window headless test**: `npm run build && npm run preview`, then `npm run e2e` (it drives Edge over the DevTools protocol; `E2E_BASE` overrides the URL). It passes **52/52** on the React build with a **stubbed** LLM. It covers every mechanism, the few-shot templates, batched and persistent requests, notes on every mechanism, section links, whole-prompt sources, code-first prompts, comments, shared context on edit, prompt-only history versions, the offline highlight, unlink by icon, reordering, Reset, and Python execution. Pyodide comes from jsdelivr; when the CDN is unreachable, the test stops with a clear message instead of hanging.
- **Not yet re-run with a real model:** the new and changed prompts (whole-prompt refer, prompt-from-code, few-shot link and request, batched inputs) were only checked with the stub. The real-model findings above predate them.
- Rehearse the demo script once before class: the model's choices (variable names, trailing `dropna()`) change what each mechanism visibly does.
