// Execution code blocks: the main thread talks to the Pyodide worker (pyWorker.js) with {id, cells} → {id, res|err}.
import { S, ui, put, busy } from './store.js';
import { emit } from './bus.js';
import { ordered } from './model.js';
import { toast, toastErr } from './ui.js';
import { uid } from './util.js';
import { pyWorkerMain } from './pyWorker.js';

const RUNNER = String.raw`
import sys, io, json, base64, ast, traceback
import matplotlib.pyplot as plt
import pandas as pd
pd.set_option('display.width', 120); pd.set_option('display.max_columns', 20)
def _exec(src, ns, echo):
    tree = ast.parse(src)
    last = tree.body.pop() if echo and tree.body and isinstance(tree.body[-1], ast.Expr) else None
    exec(compile(tree, '<cell>', 'exec'), ns)
    if last is not None:
        v = eval(compile(ast.Expression(last.value), '<cell>', 'eval'), ns)
        first = v[0] if isinstance(v, (list, tuple)) and v else v
        if v is not None and 'matplotlib' not in type(first).__module__:
            print(v)
_ns = {'__name__': '__main__'}
_res = {'text': '', 'img': None, 'err': None}
plt.close('all')
for _i, _src in enumerate(_cells):
    _last = _i == len(_cells) - 1
    _buf, _old = io.StringIO(), sys.stdout
    sys.stdout = _buf
    try:
        _exec(_src, _ns, _last)
    except Exception as e:
        _res['err'] = ('' if _last else 'Error in an earlier block (#%d):\n' % (_i + 1)) + ''.join(traceback.format_exception_only(type(e), e))
    finally:
        sys.stdout = _old
    if _last:
        _res['text'] = _buf.getvalue()[-6000:]
        if plt.get_fignums():
            _b = io.BytesIO(); plt.gcf().savefig(_b, format='png', dpi=80, bbox_inches='tight')
            _res['img'] = base64.b64encode(_b.getvalue()).decode()
    plt.close('all')
    if _res['err']: break
json.dumps(_res)
`;

const worker = new Worker(URL.createObjectURL(new Blob([`(${pyWorkerMain})()`], { type: 'text/javascript' })));
const calls = {};
worker.onmessage = ({ data }) => {
  if (data.stat) { ui.py = { text: data.stat, s: /ready/.test(data.stat) ? 'ok' : /failed/.test(data.stat) ? 'err' : 'load' }; emit(); }
  if (data.id) { calls[data.id](data); delete calls[data.id]; }
};
worker.postMessage({ init: true, csvUrl: new URL('data/titanic.csv', location.href).href });
export const pyRun = cells => new Promise(r => { const id = uid(); calls[id] = r; worker.postMessage({ id, cells, runner: RUNNER }); });

// ponytail: fresh namespace, re-runs every block above on each Run (deterministic, slower than a live kernel)
export async function run(id) {
  if (ui.BUSY[id]) return;
  const chain = ordered().filter(b => b.kind === 'p' && b.code.trim());
  const i = chain.findIndex(b => b.id === id);
  if (i < 0) return toast('Nothing to run yet: generate or write code first.');
  busy(id, 'running…');
  try {
    const d = await pyRun(chain.slice(0, i + 1).map(b => b.code));
    if (d.err) throw new Error('Python: ' + d.err);
    const b = S.blocks[id]; b.out = d.res; put('blocks', b);
  } catch (e) { toastErr(e.message); } finally { busy(id, null); }
}
export function clearOutput(id) { const b = S.blocks[id]; b.out = null; put('blocks', b); }
