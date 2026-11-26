// The offline demo's own copy of Pyodide: the runtime plus pandas and matplotlib (with their dependencies), about 75 MB,
// into frontend/public/pyodide/ (git-ignored; the build copies it next to app/ and demo/). With it, the demo needs no CDN
// (lib/python.js). Files already there are kept, so a second run downloads nothing. Used by offline.mjs and pages.yml.
import fs from 'node:fs';
import path from 'node:path';

const CDN = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/'; // the version lib/python.js loads
const dir = path.resolve(import.meta.dirname, '../frontend/public/pyodide');
fs.mkdirSync(dir, { recursive: true });

async function get(f) {
  const to = path.join(dir, f);
  if (fs.existsSync(to) && fs.statSync(to).size > 0) return;
  const r = await fetch(CDN + f);
  if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
  fs.writeFileSync(to + '.part', Buffer.from(await r.arrayBuffer()));
  fs.renameSync(to + '.part', to); // never leave a half-written file that a later run would keep
}

await get('pyodide-lock.json');
const lock = JSON.parse(fs.readFileSync(path.join(dir, 'pyodide-lock.json'), 'utf8')).packages, need = new Set();
const add = n => { if (need.has(n)) return; need.add(n); lock[n].depends.forEach(add); };
['pandas', 'matplotlib'].forEach(add); // what the demo loads (lib/python.js)
const files = ['pyodide.js', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', ...[...need].map(n => lock[n].file_name)];
for (const f of files) await get(f);
console.log(`Pyodide for the offline demo: ${files.length + 1} files in ${path.relative(process.cwd(), dir)}`);
