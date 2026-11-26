// The offline demo on this machine: `node scripts/offline.mjs` (or double-click offline.cmd). No server and no API key:
// it builds the frontend, serves it on :8010 and opens frontend/demo/ (Alice and Bob in one page, a scripted model).
// The first run downloads the demo's own Pyodide (scripts/fetch-pyodide.mjs); after that it runs without internet. Ctrl+C stops it.
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const fe = path.resolve(import.meta.dirname, '../frontend'), PORT = 8010, url = `http://localhost:${PORT}/demo/`;
if (!fs.existsSync(path.join(fe, 'node_modules'))) execSync('npm install', { cwd: fe, stdio: 'inherit' });
// the demo's own Pyodide (once, ~75 MB): afterwards the demo needs no internet at all
try { execSync(`"${process.execPath}" "${path.join(import.meta.dirname, 'fetch-pyodide.mjs')}"`, { stdio: 'inherit' }); }
catch { console.warn('Could not download Pyodide now; the demo will load it from the CDN instead.'); }
execSync('npm run build', { cwd: fe, stdio: 'inherit' });
const preview = spawn(process.execPath, [path.join(fe, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT)], { cwd: fe, stdio: 'inherit' });
preview.on('exit', c => process.exit(c ?? 0));
process.on('SIGINT', () => preview.kill());

const open = u => process.platform === 'win32' ? spawn('rundll32', ['url.dll,FileProtocolHandler', u])
  : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [u]);
setTimeout(() => { console.log(`\nOffline demo: ${url}\n`); if (!process.env.NO_OPEN) open(url); }, 2000);
