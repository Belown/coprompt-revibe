# CoPrompt revibe

A reimplementation of *CoPrompt: Supporting Prompt Sharing and Referring in Collaborative Natural Language Programming* (Feng, Yen et al., CHI '24), built from the paper alone.

## Run it

```
cd coprompt-revibe
python -m http.server 8000
```

1. Open `http://localhost:8000/?user=Alice`, then click **Open as Bob** to get a second window. Put the two windows side by side. The windows sync with each other through `BroadcastChannel`.
2. Click **API key** and paste a DeepSeek key. It is stored in localStorage and shared by both windows. The default model is `deepseek-flash` (thinking disabled, for speed). In the same dialog you can switch to `deepseek-v4-pro`, or enter any `claude-…` model name together with an Anthropic key.
3. The first load fetches Pyodide, pandas, sklearn and matplotlib from the CDN, which takes about 20–40 s. Wait until the header says "Python: ready".
4. **Reset demo** restores the scenario in both windows.

The page needs an internet connection, for the CDN and the API.

## Deploy to GitHub Pages

The app is fully static (no backend), so it works on GitHub Pages as-is. Push `index.html` and `data/titanic.csv` to a repo, then go to **Settings → Pages → Deploy from a branch** (root). Then open `https://<you>.github.io/<repo>/?user=Alice`.

- **Never commit an API key.** Each viewer pastes their own in **API key**. It stays in that browser's localStorage and is sent only to the provider. DeepSeek and Anthropic both accept browser calls from `github.io`.
- **Collaboration is still same-browser only.** BroadcastChannel connects windows of one browser on one machine, which is fine for a projector demo. Real multi-device collaboration needs a hosted sync service, which GitHub Pages cannot run itself. The paper used Hocuspocus + Firebase; Firebase or a Y.js provider would be the options.

## Demo script (Fig. 2 scenario, with the paper's own user-study dataset, Titanic)

| Step | Who | Action | Paper figure |
|---|---|---|---|
| 0 | Alice | Show the wiki. Fold sections and click a row to jump to it. Run the seeded "load data" block. | Fig. 3 a–c |
| 1 | Alice | Hover the heading *1. Missing values*, click **+ prompt**, type `drop columns with missing values in df` and press Enter (or click **Generate code**). Click **Run**. | |
| 2 | Alice | Under *2. Encode*, write `encode categorical features in df and store the result as df_encoded`, then Enter and Run. Naming a new variable matters for step 3. | |
| 3 | Bob | Under *3. Feature transformation*, write `calculate the skewness of all features in df`. Double-click `df`, click **Make node**, then hover Alice's encode prompt in the wiki and click **refer**. The node becomes `df_encoded` and the code is rebuilt. | Fig. 4 |
| 4 | Bob | Under *4. Correlation*, write `plot the correlation matrix of df as a heatmap`. Make a node from `df`, then click **request** on Alice's *missing values* prompt and type "fill missing values instead of dropping the columns". | Fig. 5 a–b |
| 5 | Alice | Notice the red dot in Messages. Change the prompt to `fill missing values in df without dropping any rows or columns` and press Enter. The LLM checks the request and Bob's block regenerates (toast + "fulfilled"). A vaguer prompt often produces a trailing `dropna()`, and then the check (correctly) says *not fulfilled*. | Fig. 5 c |
| 6 | Alice → Bob | Alice adds `remove outliers of df` under *5*. Bob makes a node from `skewness` in his prompt and clicks **share** on it. Alice gets a pop-up; accepting regenerates her code so it only filters features with high skew. | Fig. 6 |
| 7 | Alice | Make a node from `df` in the missing-values prompt. Click the `df` chip in the encode row of the wiki (target), then **link**. Append ` and store the result as df_filled` to the missing-values prompt and press Enter: the encode block switches to `df_filled` in both prompt and code. To rename later, make `df_filled` a node and **double-click the chip**. Use **unlink** in Messages to stop the sync. | Fig. 7 |
| 8 | either | Click the lightbulb (Explain) on a block for the explanation view (hover a step to trace prompt phrases to code lines). Click the clock (History): pick a version to see the diff, then restore it. | Fig. 3 d–e |

## What was reproduced

- A block editor with headings and prompt blocks, where each prompt block has code underneath and a Run button. Pressing Enter generates code: the *add* template is used when the block has no code, and the *edit* template when it does. Both templates are transcribed from Fig. 12–13.
- The Prompt Wiki: a multi-level, foldable outline that shows author badges and action dots, with click-to-navigate.
- The Message panel: actions in chronological order, with unprocessed actions pinned at the top with a dot, and From/To links that jump to the block.
- Nodes: you select a phrase and it becomes an atomic chip, which is the source node. In the wiki, the target can be a selected phrase, a clicked chip, the whole prompt, or a heading (share and request only).
- All four mechanisms:
  - **Refer** regenerates the requester's block from the target's prompt, code and execution result.
  - **Request** is queued, and every later code change under the target is checked with the Fig. 15 template. When the check passes, the requester's block is auto-regenerated.
  - **Share** shows a pop-up to the owner. Accepting regenerates the block, or attaches the context to a heading for future prompts.
  - **Link** checks both directions with the Fig. 14 template on every code change and propagates updates.
- The explanation view, and a history view with a diff and restore.
- Presence (which block a collaborator is in) and the "offline" case: a share sent while the other window is closed pops up when it is opened again.

## Where this version diverges (and why)

| Paper | Revibe | Why |
|---|---|---|
| GPT-4 via OpenAI | DeepSeek (`deepseek-flash`, OpenAI-compatible API; Claude optional), called directly from the browser | The original model is a moving target anyway. Using the same templates keeps the comparison fair-ish. |
| TipTap/ProseMirror + Y.js CRDT + Hocuspocus server + Firebase RTDB/Firestore | `BroadcastChannel` + localStorage, with per-object last-writer-wins | No server is needed for a classroom demo. **It only works for windows in one browser on one machine.** Concurrent typing in the *same* prompt is not merged. |
| Real-time cursors and text selections | Only "✎ Bob" on the block he is focused in | Cursor rendering inside contenteditable is a project of its own. |
| Pyodide in a Web Worker | Also a Web Worker, but **Run re-executes every block above in a fresh namespace** | This is deterministic and avoids stale or partial kernel state, which the paper never specifies. |
| Server-side logging (Firestore) | None | Logging is not part of the interaction. |
| Icon-only mechanism buttons | Coloured word pills (icon + word: refer, request, share, link) | Easier for the audience to read. |
| Fig. 15 request output = `{id, index, fulfilled}` | Adds a `reasoning` field before `fulfilled` | §6.3 says the templates use chain-of-thought, but Fig. 15 has no place for it. See findings below. |
| Fig. 14 link input = current code of both segments | Adds the linked phrases, A's `previous_code`, and the sentence "the user linked them because they denote the same value" (taken from §6.2.5) | Without these, the check never propagated a rename (see findings). |
| Node text edited in place (Fig. 7c) | Nodes are atomic chips; **double-click a chip to rename it**, which also regenerates the block | Renaming an atomic chip needed a separate interaction. |

## Underspecified details (decisions I had to make)

1. **No templates are given for refer, share or explain.** The paper only provides add, edit, link and request (Fig. 12–15). How a referred prompt gets *rewritten* is a big gap: in Fig. 4c "data" becomes `df_encode`, and nothing says how. I ask the LLM for `{node_text, code}` and substitute the node text.
2. **Is refer one-shot or live?** Is it re-applied when the referred prompt changes later? The paper says it "instantly" regenerates. I made it one-shot, because link is the live mechanism.
3. **Link direction.** The text says links update "when one side is updated", but Fig. 7 talks about "source → target". I made links bidirectional. That needed a cycle guard, because A→B→A loops otherwise.
4. **Which client runs the detection?** Request fulfilment and link checks are LLM calls triggered by *someone's* edit. I run them in the window that made the edit. As a result, the editor's API key pays, and the requester's block changes without the requester doing anything.
5. **What counts as a code change?** I use generate, a manual code edit (on blur), a mechanism update, and restore. Prompt-only edits do not count until they are regenerated.
6. **Requests on headings.** These are mentioned only in the *results* section (§8.3.1, "request tasks at higher-level headings"). I treat any code change under that heading as a candidate fulfilment.
7. **"Unprocessed" in the message panel.** For request and share this means still open. For refer and link, which need no reply, I count them as unread until the user clicks the message.
8. **Fig. 12 says "no comments", but Fig. 3 shows commented code.** I followed the template.
9. **Shared, or per-user, kernel?** The paper says the Python and OpenAI "kernels do not overlap", but not whether collaborators share execution state. See the Run divergence above.
10. **The coloured dots at the top right of every block (Fig. 3–7)** are never explained. I used them as action-type dots.
11. **Version granularity for history.** I store a version on every code change, not on every keystroke.

## What resisted reimplementation / what the paper made look easy

- **Turning a selection into a node inside contenteditable.** It has to be an atomic chip, and remote updates must not destroy the cursor of the person typing. A focused prompt now takes remote changes unless you have typing that hasn't been saved yet (300 ms debounce). Two people typing in the *same* prompt at the same moment is still last-writer-wins. TipTap + Y.js hide this whole problem in the paper.
- **"Automatic" synchronisation means an LLM call on every code change, for every link and open request.** That adds latency (seconds, not "instant"), adds cost, and can cascade through chained links. The paper presents this as a lightweight background check.
- **Fulfilment detection is an LLM yes/no judgement** (Fig. 15). False positives silently rewrite a collaborator's code, and borderline cases flip between runs (see findings). It connects to P12's "slight loss of control".
- **A bug in my own build:** two windows that start at the same time each seeded their own notebook, which duplicated every block. Real-time collaboration has many of these first-load and ordering edge cases, and the paper does not mention any.
- **Scope-creep temptation:** the agent wanted to add a mock-LLM mode and a multi-user server. I kept it to what the paper claims.

## Findings from testing with a real model (DeepSeek `deepseek-flash`, 2026-11-09)

- **Request verdicts flip on borderline code.** Alice's code filled the NaNs but ended with `df = df.dropna()`. With the paper's Fig. 15 format, the verdict was *not fulfilled*. With a reasoning field it said *fulfilled* once, then *not fulfilled* in 4 of 5 repeats. The judge is strict and defensible but not deterministic: the same edit can or cannot trigger the automatic rewrite of a collaborator's block.
- **The link check needs to know what changed.** Fig. 14 only shows each segment's current code. When Alice moved her result into a new variable (`df_filled`), the check answered "no update needed" in 3 of 3 runs ("A only creates a new variable and does not modify df"). Adding A's previous code made it correct in 5 of 5. The paper never says what the link check sees.
- **Which phrase you link matters, and the UI gives no hint.** Linking the *input* `df` of "encode … in df and store as df_encoded" to Bob's `df` correctly produced nothing to sync. Fig. 7 links the *output* name.
- **Refer only rewrites the node if the collaborator introduced a new variable.** With in-place `df` code the node stays `df`. With `df_encoded` it becomes `df_encoded`, as in Fig. 4c.
- **Implicit dependencies break silently.** Once Alice's steps stopped changing `df` in place, every block that still read `df` failed ("could not convert string to float"). Links only carry changes along explicit edges, so Bob had to re-refer by hand. This is the paper's "procedural dependency" problem, only partly solved.
- **Latency:** 1–2 s per DeepSeek call. Every code change adds one call per link or open request, and cascades took about 3 s. That is fast, but not the "instant" the paper describes.
- **Platform details found by testing in real Chrome:** double-clicking a word on Windows also selects the trailing space, so nodes swallowed it (now trimmed). While Run executed Python on the main thread, the page froze and clicks landed in the wrong place. Python now runs in a Web Worker, as in the paper.

## Verification

- **Real Chrome, two tabs (Alice/Bob), DeepSeek:** every feature was exercised through the UI. That covers generate (add/edit), Run chaining with errors, plots and seaborn, sync and presence, wiki fold and jump, the message panel, history diff and restore, heading levels, delete, reset, and all four mechanisms including the share-while-offline pop-up and link rename propagation.
- A two-window headless test (`node e2e.mjs`, with the server running on port 8765, run over the DevTools protocol in Edge) passes 15/15 with a **stubbed** LLM, as a regression check.
- Rehearse the demo script once before class: the model's choices (variable names, trailing `dropna()`) change what each mechanism visibly does.
