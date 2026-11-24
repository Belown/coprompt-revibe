// Prompt templates. Fig. 12–15 are transcribed from the paper; refer/share/explain/describe are ours (the paper gives none).
import { text } from './model.js';

// Few-shot examples of Fig. 14 (link) and Fig. 15 (request), as JSON. Fig. 14's example is garbled in the paper
// (its input shows A *before* the change while the reasoning says A was changed, and updated_code repeats A),
// so A's previous and new code are both given here and only B is updated. The reasoning sentences are the paper's.
export const LINK_EX = {
  input: [{ id: 'pair1', index: 1,
    Code_Segment_A: { prompt: 'define a function that sums the numbers', linked_phrase: 'calculate_sum',
      previous_code: 'def calculate_sum(a, b):\n    return a + b', code: 'def calculate_sum(a, b, c):\n    return a + b + c' },
    Code_Segment_B: { prompt: 'print the sum of 2 and 3', linked_phrase: 'calculate_sum', code: 'result = calculate_sum(2, 3)\nprint("The sum is:", result)' } }],
  output: [{ id: 'pair1', index: 1,
    reasoning: 'The update is required because Code Segment A has been modified to include an additional parameter in the function calculate_sum. Consequently, Code Segment B needs to be updated to pass the additional argument when calling the function.',
    updated: true, updated_code: 'result = calculate_sum(2, 3, 5)\nprint("The sum is:", result)', updated_phrase: null }],
};
export const REQ_EX = {
  input: { completion: 'iris = load_iris()', requests: [
    { id: 'qodwjqoiojJ@OIJoihiy2ge1i12jhqiuo', index: 1, prompt: 'Visualize iris data in pairplot',
      code: "import pandas as pd\nimport seaborn as sns\nsns.pairplot(iris, hue='species')", supplementary_info: 'plot data' },
    { id: 'qwedojio@o3289901hANUIl-jio', index: 6, prompt: 'Visualize wine data',
      code: "import pandas as pd\nimport seaborn as sns\nsns.pairplot(wine, hue='species')", supplementary_info: 'Provide me wine data' }] },
  output: [
    { id: 'qodwjqoiojJ@OIJoihiy2ge1i12jhqiuo', index: 1, reasoning: 'The UserB is requesting code to "plot data" from the prompt "visualize iris data" UserA used. The code plots the loaded iris data as a pairplot, so it meets the request.', fulfilled: true },
    { id: 'qwedojio@o3289901hANUIl-jio', index: 6, reasoning: 'The UserB is requesting code to "provide me wine data" from the prompt "visualize wine data" UserA used. The code only plots a variable wine that is never loaded or returned, so it does not provide the data.', fulfilled: false }],
};
// a prompt with its nodes written as [[k|text]], so the LLM can rewrite the prompt while keeping the nodes
export function marked(b, k = 0) { return b.segs.map(s => s.t === 'node' ? `[[${k++}|${s.v}]]` : s.v).join(''); }
export function applyPrompt(b, s) { // parse a rewritten marked prompt back into segments; false if any node got lost
  const nodes = b.segs.filter(x => x.t === 'node'), segs = [], got = new Set(), re = /\[\[(\d+)\|([^\]]*)\]\]/g;
  let last = 0, m;
  while ((m = re.exec(s))) {
    const k = +m[1]; if (!nodes[k] || got.has(k) || !m[2].trim()) return false;
    got.add(k); if (m.index > last) segs.push({ t: 'text', v: s.slice(last, m.index) });
    segs.push({ ...nodes[k], v: m[2].trim() }); last = re.lastIndex;
  }
  if (got.size !== nodes.length || !s.trim()) return false;
  if (last < s.length) segs.push({ t: 'text', v: s.slice(last) });
  b.segs = segs; return true;
}

// Prompt templates — Fig. 12–15 of the paper (transcribed, with Fig. 14–15's few-shot examples), plus our own for refer/share/explain/describe (not given in paper).
export const T = {
  add: (p, refer) => `[ADD] As an AI Python code-writing assistant, your task is to generate specific Python code segments based on the user's input in [$PROMPT]. When a request for code continuation is made, refer to context from [$REFER]. In such cases, concatenate the prompt with the previously generated code from [$REFER] to form a cohesive extension.
Requirements:
- Accurately generate Python code that aligns with the directives in [$PROMPT].
- In case of code continuation, seamlessly integrate new code with the existing code from [$REFER].
- Focus on the latter parts of the prompt if it contains multiple instructions, but ensure that the entire prompt is considered.
- Provide concise responses, strictly limited to the required code without additional explanations, contextual information, or comments.

[$PROMPT]: ${p}
[$REFER]:
${refer}`,
  edit: (p, ctx, above) => `As an AI Python code editor, your role is to modify existing Python code based on user instructions in [$PROMPT]. Use the code provided in [$CONTEXT] as the base for your modifications. The user will specify the exact changes needed, which may include bug fixes, adding new functionalities, or altering existing ones.
Guidelines:
- Clearly understand and follow the modification instructions in [$PROMPT].
- Ensure that the edited code remains consistent with the overall logic and structure of the original code in [$CONTEXT].
- If the prompt includes multiple edit requests, prioritize them based on their order in the prompt.
- The response should be limited to the modified code only, without additional explanations or comments.
- Maintain the integrity of the original code, ensuring that changes do not introduce new errors or disrupt existing functionalities.

[$PROMPT]: ${p}
[$CONTEXT]:
${ctx}
(Code of the blocks above, already executed:)
${above}`,
  link: (pairs) => `You are an AI model specializing in analyzing Python code dependencies. Your task is to assess pairs of code segments provided by the user, identify procedural dependencies between them, and determine if any changes in one segment necessitate updates in the other.
Input: A list of pairs of code segments, each with a unique identifier (id) and index. In every pair Code_Segment_A has just been changed (previous_code is its code before the change; B was written against previous_code) and Code_Segment_B is linked to it.
Instructions:
- Analyze Dependencies: For each pair of code segments, identify the dependencies and the impact of changes in one segment on the other.
- Decide on Updates: Based on the dependency analysis, determine if updating one segment requires changes to the other. Use logical reasoning to justify your decision.
- Provide Updated Code: If an update is necessary, provide the updated code for the affected segment (Code_Segment_B only).
- Linked phrase: each pair names the linked phrase in A's prompt and in B's prompt (or a whole section). The user linked them because they denote the same variable/value, possibly under different names. B must follow whatever A's linked phrase now refers to in A's code (e.g. if A now stores its result under a new variable name, B must use that new name). If B's phrase should change to stay consistent, give the new phrase.
- note: when present, the user's own words about why the two were linked.
Output Format: a JSON list with one object per pair:
- id: [Unique identifier of the code pair]
- index: [Index number of the code pair]
- reasoning: [your step-by-step reasoning, written before deciding]
- updated: [Boolean indicating if an update is necessary]
- updated_code: [String containing the updated code of B, if applicable]
- updated_phrase: [new text for B's linked phrase, or null]
Example input:
${JSON.stringify(LINK_EX.input, null, 1)}
Example output:
${JSON.stringify(LINK_EX.output, null, 1)}

Input:
${JSON.stringify(pairs, null, 2)}`,
  request: (input) => `You are an AI model tasked with evaluating whether the provided code fulfills specific user requests. Each request comes with a set of details including an ID, an index number, a prompt, the generated code, and supplementary information.
Input: the completion (code that already ran before the evaluated code) and a list of user requests, each containing:
- id: [string] - The ID of the request.
- index: [number] - The index of the request.
- prompt: [string] - The original prompt used for the code request.
- code: [string] - The generated code based on the prompt.
- supplementary_info: [string] - Additional information or specific requirements related to the request.
Task: Evaluate if the 'code' from each request successfully meets the criteria or needs expressed in the 'supplementary_info'. Please logically reason through each request, considering how the 'code' corresponds to the 'supplementary_info'.
Output Format: Return a JSON list of objects, each including:
- id: [string] - The same ID as in the input.
- index: [number] - The same index as in the input.
- reasoning: [string] - your reasoning relating the code to the supplementary_info, written before deciding (as in the example)
- fulfilled: [boolean] - Indicates whether the code fulfills the supplementary info
Example input:
${JSON.stringify(REQ_EX.input, null, 1)}
Example output:
${JSON.stringify(REQ_EX.output, null, 1)}

Input:
${JSON.stringify(input, null, 2)}`,
  // not in the paper: how refer / share / fulfilled-request rebuild a prompt block
  regen: (mine, node, prov, msg, above, codeOnly) => `A collaborator's work is given as context for the user's prompt block. Rewrite the user's block so it builds on the collaborator's work (use the variables, columns and results the collaborator's code produces instead of re-deriving them).
[$PROMPT] user's prompt, with its nodes marked as [[k|text]]: ${marked(mine)}
[$NODE] the part of the user's prompt that points at the collaborator's work: ${node ? marked({ segs: [node] }, mine.segs.filter(s => s.t === 'node').indexOf(node)) : '(the whole prompt)'}
[$CODE] user's current code:
${mine.code || '(none yet)'}
[$REFER] collaborator ${prov.author}'s prompt: ${prov.prompt}
collaborator's code:
${prov.code || '(none)'}
collaborator's execution result:
${(prov.out || '(not run)').slice(0, 2000)}
${msg ? `[$MESSAGE] note from the collaborator who set this up: ${msg}\n` : ''}[$ABOVE] code of the blocks above the user's block:
${above}
${codeOnly ? `Keep the user's prompt as it is; only rewrite the code.
Return JSON: {"code": "<complete Python code for the user's block, no comments>"}`
  : `Also rewrite the user's prompt so it describes the new code. Make the smallest change that keeps the user's wording and intent, e.g. "handle the skewed features using the above [[0|data]]" may become "handle the skewed features in the encoded [[0|df_encode]]". Keep every [[k|...]] marker exactly once with the same k; you may change the text inside a marker (typically to the collaborator's variable name).
Return JSON: {"prompt": "<rewritten prompt, all markers kept>", "node_text": "<new text for [$NODE], or null>", "code": "<complete Python code for the user's block, no comments>"}`}`,
  // not in the paper: §6.3 "initiate a code block and manually input code, pausing midway to generate a prompt block from the code comments"
  describe: (code) => `The user started this block code-first: they wrote the Python code below by hand (its comments say what they intend) and now want the natural-language prompt for it, so the block becomes a normal prompt block that collaborators can read, refer to and regenerate.
Write that prompt: one short imperative sentence (two at most), in the style of "encode categorical features in df and store the result as df_encoded". Base it on the comments first; describe uncommented code by what it does. Name the variables the code reads and creates.
CODE:
${code}
Return JSON: {"prompt": "<the prompt>"}`,
  explain: (b) => `Explain how this code implements its natural-language prompt, step by step, linking prompt phrases to code lines.
PROMPT: ${text(b)}
CODE (numbered):
${b.code.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n')}
Return JSON: {"steps": [{"phrase": "<exact substring of PROMPT, or a short label if implicit>", "lines": [<1-based line numbers>], "explanation": "<one short sentence>"}]}`,
};
