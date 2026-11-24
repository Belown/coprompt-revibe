# Manual test: "Who survived?"

A hands-on check of every feature, in about 15 minutes, by one person playing Alice and Bob in two windows. The storyline differs from the Fig. 2 demo in NOTES.md, so both can be used.

**Before you start**

1. Open the app (`/app/`). Enter the name **Alice**, keep the suggested session id, and click **Start**.
2. Wait until the header says **Python: ready**. The first load takes 20–40 s.
3. Check that the **API key** button is not orange. If it is, add a DeepSeek key there, or the access code if the server asks for one.
4. Click **Invite**. A pop-up shows a QR code and the session link with **Copy**. Close it with **Done**.
5. Open **⋯ → Open as Bob**. Place the two windows side by side. (To test on two devices instead, scan the QR code with a phone and join as Bob.)

Every step says who acts (**A** = Alice's window, **B** = Bob's). Type the text in `code font` exactly. "Expect" is what passes. The model's wording varies, so check what happened, not the exact words.

## 1. Writing together

| # | Who | Do | Expect |
|---|---|---|---|
| 1.1 | A | Hover the heading **1. Deal with missing values in df**, click **+ prompt**, and type `fill missing Age values in df with the median age`. Do **not** press Enter. | The text appears in B as you type. B shows Alice's avatar on the block. |
| 1.2 | B | Click at the end of that same prompt and type ` and drop the Cabin column`. | Both windows show the whole sentence, and neither person's text is lost. While B types, A sees a blue caret labelled **Bob**. |
| 1.3 | B | Double-click the word `median`. | A toolbar appears over the word: **B I U S </> highlight · Make node**. A sees the word tinted in Bob's colour (his selection). |
| 1.4 | B | Click **B** in the toolbar, then click elsewhere. | `median` is bold in **both** windows. No code is generated: formatting changes nothing for the model. |

## 2. Generate and run

| # | Who | Do | Expect |
|---|---|---|---|
| 2.1 | A | Click into the prompt from 1.1 and press **Enter**. | Python code appears under the prompt in both windows. In B, the block is marked *Updated by Alice*; clicking the block clears the mark. |
| 2.2 | A | Click **Run** on that block. | Output appears in both windows. If the code prints a count of missing values, it is 0 or small. |
| 2.3 | A | Hover the heading **2. Encode categorical features in df**, click **+ prompt**, type `encode Sex and Embarked as numbers and store the result in df_encoded`, press Enter, then click **Run**. | Code that creates `df_encoded`; it runs without an error. |

## 3. Refer (rebuild my prompt from a collaborator's)

| # | Who | Do | Expect |
|---|---|---|---|
| 3.1 | B | Under **4. Correlation analysis**, add a prompt `plot a heatmap of the correlations in df` and press Enter. | Code that plots a heatmap from `df`. |
| 3.2 | B | Double-click `df` in that prompt and click **Make node** in the toolbar. | `df` becomes a chip. The Prompt Wiki shows a dark **Source df** bar explaining the four mechanisms. Rows you can target show small icon buttons. |
| 3.3 | B | In the wiki, on Alice's row *encode Sex and Embarked…*, click the **refer** icon (its tooltip starts with "Refer"). Leave the note empty and click **Refer**. | Bob's prompt and code are rebuilt to use Alice's result: the chip reads `df_encoded`, and the block flashes orange. **Messages** in both windows shows a *refer* entry from Bob to Alice. |
| 3.4 | B | Click **Run**. | A heatmap image appears in both windows. |

## 4. Request (ask a collaborator to finish something)

| # | Who | Do | Expect |
|---|---|---|---|
| 4.1 | A | Under **5. Deal with outliers**, add a prompt `remove fare outliers from df`. Do **not** press Enter. | The prompt exists, with no code yet. |
| 4.2 | B | Under **3. Feature transformation**, add `plot the fare distribution of df` and press Enter. Make `df` a node (double-click, **Make node**). | `df` becomes a chip, and the source bar appears. |
| 4.3 | B | In the wiki, on Alice's row *remove fare outliers from df*, click the **request** icon. Type `use the IQR rule` and click **Send request**. | A's **Messages** shows the request at the top with a red dot, status *open*. Bob's block does not change yet. |
| 4.4 | A | Click into *remove fare outliers from df* and press **Enter**. | Alice's code is generated, then checked against the request. If it passes, Bob's block regenerates on its own: a toast in B, and the request becomes *fulfilled*. If it stays *open*, the model judged the code as not using IQR: append ` using the IQR rule` to Alice's prompt and press Enter again. |

## 5. Share (offer context to a collaborator)

| # | Who | Do | Expect |
|---|---|---|---|
| 5.1 | A | On the missing-values prompt from 1.1, click the **◎** button ("Use the whole prompt as the source node"). | The source bar shows the whole prompt. |
| 5.2 | A | In the wiki, on Bob's row *plot the fare distribution…*, click the **share** icon. Type `use the cleaned df` and click **Share**. | A gets a toast that the share is waiting for Bob. |
| 5.3 | B | A pop-up appears: *Alice shared … with you*, showing her note. Click **Accept**. | Bob's code for the fare plot regenerates with Alice's cleaning, and the block flashes pink. The message status becomes *accepted*. |

## 6. Link (keep two prompts in sync)

| # | Who | Do | Expect |
|---|---|---|---|
| 6.1 | A | In the encode prompt from 2.3, double-click `df_encoded` and click **Make node**. | The source bar shows `df_encoded`. |
| 6.2 | A | In the wiki, on Bob's heatmap row, click the chip `df_encoded` (it gets a dark outline), then click the **link** icon on that row. Click **Link**. | A purple link dot appears on both nodes. If Bob's row has no `df_encoded` chip (the refer in 3.3 worded it differently), click the link icon without picking a chip: the link then covers his whole prompt. |
| 6.3 | A | Double-click the `df_encoded` chip in Alice's prompt, rename it to `df_num`, and click **Rename**. | Alice's block regenerates. Seconds later, Bob's heatmap block updates by itself to use `df_num` and shows *Auto-updated · link* with a **Review** link. |
| 6.4 | B | Click **Review**, then pick the version just before *link* in the list. | The history opens. The diff shows what the link changed, and **Restore this version** would undo it. |

## 7. Reading and tracking

| # | Who | Do | Expect |
|---|---|---|---|
| 7.1 | A | On the encode block, click the **light bulb** (Explain). | Phrases of the prompt and lines of the code are highlighted in matching colours. Hovering one dims the rest. |
| 7.2 | B | On the heatmap block, click the **clock** (History). Pick an older version. | Versions are listed with time, person and action. The prompt and code show a diff. **Restore this version** brings it back, and A sees the restored version too. |
| 7.3 | B | Click the **speech bubble** on Alice's encode block, type `why not one-hot?`, and press Enter. | A gets a toast with the comment. The block's bubble shows **1** in both windows, and the wiki row shows a comment count. |
| 7.4 | A | In the wiki, click the arrow next to **Feature Analysis**, then click the row *remove fare outliers…*. | The section folds and unfolds. Clicking a row scrolls the editor to that block and flashes it. |

## 8. Presence and live cursors

| # | Who | Do | Expect |
|---|---|---|---|
| 8.1 | A, B | Click **Live cursors** in both headers. | The button turns blue. Moving the mouse anywhere in one window (a block, the header, the Wiki) shows a named arrow at the same spot in the other, even when the windows are of different sizes. |
| 8.2 | A | Point at the **API key** button, then click it. | In B, the API key button gets a box in Alice's colour, and her click shows as a ripple. As soon as her dialog opens, her arrow disappears from B (the dialog exists only in her window). It comes back when she closes it and moves the mouse. |
| 8.3 | A | Close the dialog, then click **Live cursors** again. | Alice's arrow disappears from B at once, and A no longer sees Bob's. |

## 9. Away and back

| # | Who | Do | Expect |
|---|---|---|---|
| 9.1 | B | Close Bob's window. | |
| 9.2 | A | In Bob's fare-plot block, click into the **code**, add a line `print(len(df))`, and click outside the code. | Saved. |
| 9.3 | A | **⋯ → Open as Bob**. | In Bob's new window, the fare-plot block is highlighted *Updated by Alice · edit code*, and a toast says blocks changed while he was away. Clicking the block clears the highlight. |

## If something fails

Note the step number, what you saw, and which window. A blank code area after Enter, or an "LLM error" toast, points at the API key or the server's daily limit (**API key** dialog shows calls left today), not at the step. **⋯ → Reset demo…** restores the starting notebook for everyone in the session.
