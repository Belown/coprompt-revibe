// Execution code blocks: the main thread talks to the Pyodide worker (pyWorker.js) with {id, cells} → {id, res|err}.
import { S, ui, put, busy } from './store.js';
import { emit } from './bus.js';
import { ordered } from './model.js';
import { toast, toastErr } from './ui.js';
import { uid } from './util.js';
import { pyWorkerMain } from './pyWorker.js';

// Run cache: the worker keeps, for the chain it ran last, a copy of the namespace after each block. A run whose blocks
// above are unchanged starts from the copy after them and executes only the rest (always the block itself, from the
// state before it, so re-running it never applies it twice). A namespace that cannot be copied faithfully is not
// cached: functions and classes defined in a block would keep pointing at the old namespace. Then it runs from the top.
const RUNNER = String.raw`
import sys, io, json, base64, ast, traceback, copy, types
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
def _copy(ns):  # modules, builtins and matplotlib objects are shared, the data is copied
    keep = {id(v): v for v in ns.values() if isinstance(v, types.ModuleType) or type(v).__module__.startswith('matplotlib')}
    if '__builtins__' in ns: keep[id(ns['__builtins__'])] = ns['__builtins__']
    return copy.deepcopy(ns, keep)
def _snap(ns):
    for v in ns.values():
        if getattr(getattr(v, '__code__', None), 'co_filename', None) == '<cell>' or type(v).__module__ == '__main__' \
                or (isinstance(v, type) and v.__module__ == '__main__'):
            return None
    try: return _copy(ns)
    except Exception: return None
_cache = globals().setdefault('_cp_cache', [])  # [(block code, namespace after it or None)] for the chain run last
_n = len(_cells); _k = 0
while _k < _n - 1 and _k < len(_cache) and _cache[_k][0] == _cells[_k] and _cache[_k][1] is not None: _k += 1
_ns = _copy(_cache[_k - 1][1]) if _k else {'__name__': '__main__'}
del _cache[_k:]
_res = {'text': '', 'img': None, 'err': None, 'reused': _k}
plt.close('all')
for _i in range(_k, _n):
    _src, _last = _cells[_i], _i == _n - 1
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
    _cache.append((_src, _snap(_ns)))
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

// Run executes the chain of code blocks above this one; the worker's run cache (RUNNER) skips the unchanged prefix
export async function run(id) {
  if (ui.BUSY[id]) return;
  const chain = ordered().filter(b => b.kind === 'p' && b.code.trim());
  const i = chain.findIndex(b => b.id === id);
  if (i < 0) return toast('Nothing to run yet: generate or write code first.');
  busy(id, 'running…');
  try {
    const d = await pyRun(chain.slice(0, i + 1).map(b => b.code));
    if (d.err) throw new Error('Python: ' + d.err);
    const { reused, ...out } = d.res; // reused: blocks the run cache skipped (tests read it from pyRun)
    const b = S.blocks[id]; b.out = out; put('blocks', b);
  } catch (e) { toastErr(e.message); } finally { busy(id, null); }
}
export function clearOutput(id) { const b = S.blocks[id]; b.out = null; put('blocks', b); }
