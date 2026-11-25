// Backup for a talk: the whole app on this laptop, no server. `node scripts/offline.mjs` (or double-click offline.cmd).
// Builds the frontend, starts the sync backend on :8787 and the built app on :8000, opens Alice's and Bob's windows.
// Still needs internet for Pyodide (CDN) and the LLM. Ctrl+C stops both.
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..'), fe = path.join(root, 'frontend'), be = path.join(root, 'backend');
try { process.loadEnvFile(path.join(root, '.env')); } catch { /* no .env: enter a key with the API key button */ }
for (const d of [be, fe]) if (!fs.existsSync(path.join(d, 'node_modules'))) execSync('npm install', { cwd: d, stdio: 'inherit' });
execSync('npm run build', { cwd: fe, stdio: 'inherit' });

const kids = [
  spawn(process.execPath, ['server.js'], { cwd: be, stdio: 'inherit' }),
  spawn(process.execPath, [path.join(fe, 'node_modules/vite/bin/vite.js'), 'preview'], { cwd: fe, stdio: 'inherit' }),
];
const stop = () => { kids.forEach(k => k.kill()); process.exit(); };
process.on('SIGINT', stop);
kids.forEach(k => k.on('exit', c => { if (c) { console.error('a process exited with code', c); stop(); } }));

const room = process.argv[2] || 'demo';
const urls = ['Alice', 'Bob'].map(u => `http://localhost:8000/app/?user=${u}&room=${room}`);
const open = u => process.platform === 'win32' ? spawn('rundll32', ['url.dll,FileProtocolHandler', u])
  : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [u]);
setTimeout(() => { console.log('\nOffline CoPrompt:\n  ' + urls.join('\n  ') + '\n'); if (!process.env.NO_OPEN) urls.forEach(open); }, 2500);
