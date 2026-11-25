// The offline demo on this machine: `node scripts/offline.mjs` (or double-click offline.cmd). No server and no API key:
// it builds the frontend, serves it on :8010 and opens frontend/demo/ (Alice and Bob in one page, a scripted model).
// Still needs internet for Pyodide (CDN), which the browser usually caches after the first load. Ctrl+C stops it.
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const fe = path.resolve(import.meta.dirname, '../frontend'), PORT = 8010, url = `http://localhost:${PORT}/demo/`;
if (!fs.existsSync(path.join(fe, 'node_modules'))) execSync('npm install', { cwd: fe, stdio: 'inherit' });
execSync('npm run build', { cwd: fe, stdio: 'inherit' });
const preview = spawn(process.execPath, [path.join(fe, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT)], { cwd: fe, stdio: 'inherit' });
preview.on('exit', c => process.exit(c ?? 0));
process.on('SIGINT', () => preview.kill());

const open = u => process.platform === 'win32' ? spawn('rundll32', ['url.dll,FileProtocolHandler', u])
  : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [u]);
setTimeout(() => { console.log(`\nOffline demo: ${url}\n`); if (!process.env.NO_OPEN) open(url); }, 2000);
