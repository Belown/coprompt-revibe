// The offline demo's model (?demo=1, config.js): scripted answers instead of an LLM, for the Titanic exercise only.
// Every template of lib/templates.js gets an answer built from the prompt's words and the variables it names, so the
// demo script (frontend/demo/, NOTES.md) also works with small changes in wording. Off-script prompts get a clear error.
// ponytail: keyword rules, not a model; to script another step, add a rule to code().

const OFF = 'The offline demo only has scripted answers for its Titanic exercise. Open the guide (top bar) for the prompts it knows.';
const frames = s => s.match(/\bdf\w*/g) || [];
const after = (s, a, b) => { const i = s.indexOf(a); if (i < 0) return ''; const r = s.slice(i + a.length), j = b ? r.indexOf(b) : -1; return j < 0 ? r : r.slice(0, j); };
const lastJSON = u => JSON.parse(u.slice(u.lastIndexOf('Input:\n') + 7));
// the last frame a piece of code assigns as a whole (df = …, df_x = …), not a column (df['Age'] = …)
const assigned = c => [...c.matchAll(/^(df\w*)\s*=(?!=)/gm)].at(-1)?.[1] ?? null;
const word = v => new RegExp(`\\b${v}\\b`, 'g');

// which frame a prompt reads, and where it stores the result ("… and store the result as df_encoded")
function io(p) {
  const m = p.match(/\b(?:store|save)\b.*?\b(?:as|in|into)\s+(df\w*)/i);
  return { src: frames(m ? p.slice(0, m.index) : p).at(-1) || 'df', out: m?.[1] || null };
}

// Fig. 12/13 (add/edit): the code for a prompt. ctx: what a collaborator shared or referred (share changes the outliers rule)
function code(p, ctx = '') {
  // the words, without the frame names (df_encoded is not a request to encode)
  const l = p.toLowerCase().replace(/\bdf\w*/g, 'df'), { src, out } = io(p), dst = out || src;
  const copy = out && out !== src ? `${dst} = ${src}.copy()\n` : '';
  if (/\b(load|read)\b/.test(l)) return "import pandas as pd\ndf = pd.read_csv('data/titanic.csv')\ndf.head()";
  if (/missing|\bnan\b|null/.test(l)) return /fill|impute/.test(l)
    ? `${copy}${dst}['Age'] = ${dst}['Age'].fillna(${dst}['Age'].median())\n${dst}['Embarked'] = ${dst}['Embarked'].fillna(${dst}['Embarked'].mode()[0])\n${dst}['Cabin'] = ${dst}['Cabin'].fillna('Unknown')\n${dst}.isna().sum()`
    : `${dst} = ${src}.dropna(${/\brows?\b/.test(l) && !/column/.test(l) ? '' : 'axis=1'})\n${dst}.shape`;
  if (/encod|dumm|categor|one-hot/.test(l))
    return `import pandas as pd\n${dst} = pd.get_dummies(${src}.drop(columns=['Name', 'Ticket', 'Cabin'], errors='ignore'), drop_first=True, dtype=int)\n${dst}.head()`;
  if (/skew/.test(l)) return `${src}.skew(numeric_only=True).sort_values(ascending=False)`;
  if (/correlat|heatmap/.test(l)) return `import matplotlib.pyplot as plt\ncorr = ${src}.corr(numeric_only=True)\nfig, ax = plt.subplots(figsize=(8, 6))\nim = ax.imshow(corr, cmap='coolwarm', vmin=-1, vmax=1)\nax.set_xticks(range(len(corr)), corr.columns, rotation=90)\nax.set_yticks(range(len(corr)), corr.columns)\nfig.colorbar(im)\nax.set_title('Correlation matrix')\nplt.show()`;
  if (/outlier/.test(l)) return `cols = [c for c in ${src}.select_dtypes('number').columns if c not in ('PassengerId', 'Survived', 'Pclass')]\n`
    + (/skew/i.test(ctx) ? `cols = [c for c in cols if abs(${src}[c].skew()) > 1]\n` : '')
    + `q1, q3 = ${src}[cols].quantile(0.25), ${src}[cols].quantile(0.75)\niqr = q3 - q1\n${dst} = ${src}[~((${src}[cols] < q1 - 1.5 * iqr) | (${src}[cols] > q3 + 1.5 * iqr)).any(axis=1)]\nprint(cols, ${dst}.shape)`;
  if (/surviv/.test(l)) return `${src}.groupby('Pclass')['Survived'].mean()`;
  if (/\bage\b/.test(l) && /class/.test(l)) return `${src}.groupby('Pclass')['Age'].mean()`;
  throw new Error(OFF);
}

// refer / share / fulfilled request: if the collaborator's code made a new frame, the prompt and its node move to it (Fig. 4c)
function regen(u) {
  const marked = after(u, 'nodes marked as [[k|text]]: ', '\n'), plain = marked.replace(/\[\[\d+\|([^\]]*)\]\]/g, '$1');
  const ctx = after(u, '[$REFER]', '[$ABOVE]'), v = assigned(after(u, "collaborator's code:\n", "\ncollaborator's execution result:"));
  if (u.includes('only rewrite the code')) return { code: code(plain, ctx) };
  const { src } = io(plain);
  if (!v || v === src) return { prompt: marked, node_text: null, code: code(plain, ctx) };
  return { prompt: marked.replace(word(src), v), node_text: v, code: code(plain.replace(word(src), v), ctx) };
}

// Fig. 15: does the provider's code now do what was asked?
const request = u => lastJSON(u).requests.map(r => {
  const need = r.supplementary_info.toLowerCase(), c = r.code;
  const ok = /fill|impute/.test(need) ? /fillna/.test(c) && !/dropna/.test(c) : /outlier/.test(need) ? /quantile/.test(c)
    : /drop/.test(need) ? /dropna|\.drop\(/.test(c) : /encod/.test(need) ? /get_dummies/.test(c) : !!c.trim();
  return { id: r.id, index: r.index, fulfilled: ok,
    reasoning: `The request asks for “${r.supplementary_info}”. The code ${ok ? 'now does that' : 'does not do that yet'}.` };
});

// Fig. 14: when A's result moves to a new frame (df → df_filled), B follows it
const link = u => lastJSON(u).map(x => {
  const A = x.Code_Segment_A, B = x.Code_Segment_B;
  const was = assigned(A.previous_code || '') || frames(A.linked_phrase)[0] || 'df', now = assigned(A.code) || was;
  const updated = now !== was && word(was).test(B.code);
  return { id: x.id, index: x.index, updated,
    reasoning: updated ? `A now stores its result in ${now} instead of ${was}, and B reads ${was}, so B must read ${now}.` : 'B does not depend on anything that changed in A.',
    updated_code: updated ? B.code.replace(word(was), now) : null, updated_phrase: updated && B.linked_phrase === was ? now : null };
});

// code-first: the prompt from the code's first comment
function describe(u) {
  const c = after(u, 'CODE:\n', '\nReturn JSON'), note = c.match(/#\s*(.+)/)?.[1].trim();
  if (!note) throw new Error('Write a comment saying what the code does (e.g. # survival rate by class), then try again.');
  const v = assigned(c), src = frames(c.replace(/^df\w*\s*=/gm, ''))[0] || 'df';
  const verb = /^(calculate|compute|plot|show|count|print|find|list|remove|fill|encode)\b/i.test(note) ? note : `compute the ${note}`;
  return { prompt: `${verb} in ${src}${v && v !== src ? ` and store it as ${v}` : ''}` };
}

// explanation view: each code line goes to the prompt phrase whose words it implements
const KEYS = [[/read_csv/, 'load read csv'], [/fillna/, 'fill missing values'], [/dropna/, 'drop missing values columns rows'],
  [/get_dummies/, 'encode categorical features'], [/skew/, 'skewness skew'], [/corr\(/, 'correlation matrix'], [/imshow|colorbar/, 'heatmap'], [/subplots|ticks|set_title|plt\.show/, 'plot'],
  [/quantile|iqr|any\(axis=1\)|cols/, 'remove outliers'], [/groupby/, 'rate class mean age'], [/\.copy\(\)|^df\w* =/, 'store result']];
const SAY = [[/read_csv/, 'Reads the CSV file into a data frame.'], [/\.copy\(\)/, 'Works on a copy, so the original frame stays as it was.'],
  [/fillna\(.*median/, 'Fills missing ages with the median age.'], [/fillna\(.*mode/, 'Fills missing ports with the most common one.'],
  [/fillna\(/, 'Marks missing cabins as Unknown.'], [/dropna/, 'Drops what has missing values.'], [/get_dummies/, 'Turns each category into its own 0/1 column.'],
  [/skew\(\)\) > 1/, 'Keeps only the strongly skewed columns.'], [/skew/, 'Measures how lopsided each numeric column is.'], [/corr\(/, 'Computes the pairwise correlations.'],
  [/imshow/, 'Draws them as a colour grid.'], [/quantile/, 'Finds the usual range of each column (the IQR).'], [/any\(axis=1\)/, 'Keeps only the rows inside that range.'],
  [/select_dtypes/, 'Picks the numeric measurement columns.'], [/groupby/, 'Averages per passenger class.'], [/import/, 'Loads the library it needs.']];
function explain(u) {
  const p = after(u, 'PROMPT: ', '\n'), lines = after(u, 'CODE (numbered):\n', '\nReturn JSON').split('\n').map(l => l.replace(/^\d+: /, ''));
  const parts = p.split(/\s*(?:,|\b(?:and|then|as|with|without|into)\b)\s*/).filter(Boolean), steps = new Map();
  let prev = parts[0];
  lines.forEach((ln, i) => {
    const ws = KEYS.filter(([re]) => re.test(ln)).flatMap(([, w]) => w.split(' ')).concat(frames(ln));
    const score = part => part.toLowerCase().split(/\W+/).filter(t => t.length > 2 && ws.some(w => t.startsWith(w) || w.startsWith(t))).length;
    const best = parts.reduce((a, b) => score(b) > score(a) ? b : a, parts[0]);
    const part = score(best) ? best : prev; prev = part;
    const s = steps.get(part) || { phrase: part, lines: [], says: [] }; steps.set(part, s);
    s.lines.push(i + 1); const say = SAY.find(([re]) => re.test(ln))?.[1]; if (say && !s.says.includes(say)) s.says.push(say);
  });
  return { steps: [...steps.values()].map(s => ({ phrase: s.phrase, lines: s.lines, explanation: s.says.join(' ') || 'Shows the result.' })) };
}

export async function scripted(u) {
  await new Promise(r => setTimeout(r, 400 + Math.random() * 500)); // a model takes a moment; so does the script
  if (u.includes('[ADD]')) return code(after(u, '[$PROMPT]: ', '\n'), after(u, '(Context that collaborators shared with this task:)'));
  if (u.includes('AI Python code editor')) return code(after(u, '[$PROMPT]: ', '\n'), after(u, '(Context that collaborators shared with this task:)'));
  if (u.includes('code dependencies')) return link(u);
  if (u.includes('fulfills specific user requests')) return request(u);
  if (u.includes('[$NODE]')) return regen(u);
  if (u.includes('code-first')) return describe(u);
  if (u.includes('Explain how this code')) return explain(u);
  throw new Error(OFF);
}


export { io, code, regen, request, link, describe, explain, assigned }; // for tests/demo-script.mjs
