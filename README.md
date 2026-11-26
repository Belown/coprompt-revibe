# CoPrompt revibe

An unofficial reimplementation of **CoPrompt** (Feng, Yen et al., CHI '24): a notebook where several people program together in natural language, building on each other's prompts. It was rebuilt from the paper alone, inspired by the UIST 2026 Revibe workshop, and is not affiliated with the paper's authors.

**Try it:** <https://coprompt-revibe.wangleishen.com/app/>. Pick a name and a session, then share the invite link.

## What it does

A shared notebook of prompt blocks, each with the Python code an LLM generates from it. The code runs in the browser with Pyodide. A new session starts from a topic, a classic dataset with five small tasks split between two people: Titanic (as in the paper's user study), Iris, Wine (as in the paper's figures) or Diabetes.

- **Four mechanisms** (§6.2) for building on a collaborator's prompt. You pick a source node in your prompt and a target in the Prompt Wiki, then choose:
  - **refer**: rebuild your prompt from their code and result.
  - **request**: ask them to finish something; your block regenerates once it is done.
  - **share**: offer your context to them; they accept it in a pop-up.
  - **link**: keep two prompts in sync whenever either side's code changes.
- **Prompt Wiki** (a foldable outline of tasks, prompts and nodes), **message panel**, **explanation view** and **history view** with diff and restore (§6.1).
- **Real-time collaboration.** Prompts are edited with TipTap on a Y.js CRDT, so two people can type in the same prompt. You see each other's text cursors and selections, a formatting toolbar appears over a selection, and live mouse pointers are available as an opt-in.
- The paper's prompt templates (Fig. 12–15), with their few-shot examples. Models: DeepSeek by default, Claude optional.

[NOTES.md](NOTES.md) lists every place where this version differs from the paper and why, the decisions the paper leaves open, and findings from testing with a real model.

## Run locally

Needs Node 20+.

```
cd backend  && npm install && npm start     # sync server on :8787
cd frontend && npm install && npm run dev   # app at http://localhost:8000/app/
```

Add a DeepSeek key under **API key** in the app. Alternatively, set `DEEPSEEK_API_KEY` in `.env` and the server lends its own key to everyone (see `.env.example`).

The first load downloads Pyodide and its packages, which takes 20–40 s.

**Offline demo** (for a talk, in case the server fails): <https://belown.github.io/coprompt-revibe/demo/>, rebuilt on every push that touches `frontend/`; on this machine, double-click `offline.cmd` (or `node scripts/offline.mjs`, which serves it at <http://localhost:8010/demo/>). One page holds Alice's and Bob's views of the app, switched with **Alice / Bob / Side by side** in its top bar. It needs no server and no API key: it runs the Titanic exercise only, both views sync inside the browser, and a script answers instead of the model (`frontend/src/lib/demo.js`). The **Guide** button lists the steps and the prompts the script knows; other prompts get a message instead of code. `offline.cmd` and the GitHub Pages build carry their own copy of Pyodide with pandas and matplotlib (`scripts/fetch-pyodide.mjs`, about 75 MB, downloaded once), so they need no internet while the demo runs; the demo on the server's own domain loads Pyodide from the CDN. The same mode is `?demo=1` on the app. Checks: `node tests/demo-script.mjs` (the script's answers), and `node ../tests/demo-e2e.mjs` from `frontend/` after `npm run build && npm run preview` (the whole guide with real clicks and typing in a headless browser; `DEMO_SIZE=1920,1080`, `DEMO_VIEW=both` for side by side, `DEMO_OFFLINE=1` to block the CDN).

Tests:

- `cd backend && npm test`: sync protocol, Y.js, limits.
- `cd frontend && npm run build && npm run preview`, then `npm run e2e`: a two-window end-to-end test with a stubbed LLM.

## Deploy

`git clone https://github.com/Belown/coprompt-revibe.git`, `cp .env.example .env` and edit it, then `docker compose up -d`. This starts Caddy, which serves the frontend and proxies `/api` to the sync server (TLS is terminated in front of it), and the deploy service: after every push to `main`, GitHub Actions asks the server to pull and rebuild. See *Deploy* in [NOTES.md](NOTES.md).

## Citation

This project reimplements the following paper. If you use it, please cite the original work:

> Li Feng, Ryan Yen, Yuzhe You, Mingming Fan, Jian Zhao, and Zhicong Lu. 2024. CoPrompt: Supporting Prompt Sharing and Referring in Collaborative Natural Language Programming. In *Proceedings of the CHI Conference on Human Factors in Computing Systems (CHI '24)*, May 11–16, 2024, Honolulu, HI, USA. ACM, New York, NY, USA, 21 pages. <https://doi.org/10.1145/3613904.3642212>

```bibtex
@inproceedings{feng2024coprompt,
  author    = {Feng, Li and Yen, Ryan and You, Yuzhe and Fan, Mingming and Zhao, Jian and Lu, Zhicong},
  title     = {CoPrompt: Supporting Prompt Sharing and Referring in Collaborative Natural Language Programming},
  booktitle = {Proceedings of the CHI Conference on Human Factors in Computing Systems},
  series    = {CHI '24},
  year      = {2024},
  location  = {Honolulu, HI, USA},
  publisher = {Association for Computing Machinery},
  address   = {New York, NY, USA},
  isbn      = {9798400703300},
  numpages  = {21},
  doi       = {10.1145/3613904.3642212},
  url       = {https://doi.org/10.1145/3613904.3642212}
}
```
