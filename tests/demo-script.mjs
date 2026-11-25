// The offline demo's scripted model (frontend/src/lib/demo.js), step by step along the demo script. node tests/demo-script.mjs
import assert from 'node:assert/strict';
import { io, code, regen, request, link, describe, explain, assigned } from '../frontend/src/lib/demo.js';

const ENC = 'encode categorical features in df and store the result as df_encoded';
assert.equal(io(ENC).out, 'df_encoded');
assert.equal(code('drop columns with missing values in df'), 'df = df.dropna(axis=1)\ndf.shape');
assert.equal(assigned(code(ENC)), 'df_encoded');
const fill = code('fill missing values in df without dropping any rows or columns');
assert.ok(/fillna/.test(fill) && !/dropna/.test(fill));
const filled = code('fill missing values in df without dropping any rows or columns and store the result as df_filled');
assert.equal(assigned(filled), 'df_filled');

// refer (Fig. 4): Bob's skewness prompt moves to Alice's df_encoded
const r = regen(`[$PROMPT] user's prompt, with its nodes marked as [[k|text]]: calculate the skewness of all features in [[0|df]]\n[$NODE] x\n`
  + `[$REFER] collaborator Alice's prompt: ${ENC}\ncollaborator's code:\n${code(ENC)}\ncollaborator's execution result:\n\n[$ABOVE] x\nReturn JSON`);
assert.equal(r.prompt, 'calculate the skewness of all features in [[0|df_encoded]]');
assert.equal(r.node_text, 'df_encoded');
assert.equal(r.code, 'df_encoded.skew(numeric_only=True).sort_values(ascending=False)');

// request (Fig. 5): fulfilled by filling, not by dropping
const req = c => request('Input:\n' + JSON.stringify({ requests: [{ id: 'r', index: 1, code: c, supplementary_info: 'fill missing values instead of dropping the columns' }] }))[0].fulfilled;
assert.equal(req(fill), true);
assert.equal(req(code('drop columns with missing values in df')), false);

// share (Fig. 6): Bob's skewness narrows Alice's outlier filter
assert.ok(/skew\(\)\) > 1/.test(code('remove outliers of df', "collaborator Bob's prompt: calculate the skewness of all features in df_encoded")));
assert.ok(!/skew/.test(code('remove outliers of df')));

// link (Fig. 7): Alice stores df_filled, the encode prompt follows
const pair = (prev, now) => link('Input:\n' + JSON.stringify([{ id: 'a', index: 1, Code_Segment_A: { linked_phrase: 'df', previous_code: prev, code: now },
  Code_Segment_B: { linked_phrase: 'df', code: code(ENC) } }]))[0];
const l = pair(fill, filled);
assert.equal(l.updated, true);
assert.equal(l.updated_phrase, 'df_filled');
assert.ok(/get_dummies\(df_filled\.drop/.test(l.updated_code));
assert.equal(pair(fill, fill).updated, false);

// code-first, explanation, off-script
assert.equal(describe('CODE:\n# survival rate by class\ndf.groupby("Pclass")["Survived"].mean()\nReturn JSON').prompt, 'compute the survival rate by class in df');
const heat = 'plot the correlation matrix of df as a heatmap', ex = explain(`PROMPT: ${heat}\nCODE (numbered):\n${code(heat).split('\n').map((x, i) => `${i + 1}: ${x}`).join('\n')}\nReturn JSON`);
assert.ok(ex.steps.length > 1 && ex.steps.every(s => heat.includes(s.phrase)), JSON.stringify(ex.steps));
assert.throws(() => code('train a neural network'), /offline demo/);
console.log('demo script: all checks pass');
