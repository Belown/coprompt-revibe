import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Two pages: the blog at / (index.html) and the app at /app/ (app/index.html).
// base './' keeps every URL relative. Port 8000 for dev and preview: the local origin the backend allows by default.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { rollupOptions: { input: { blog: 'index.html', app: 'app/index.html', demo: 'demo/index.html' } } },
  server: { port: 8000, strictPort: true },
  preview: { port: 8000, strictPort: true },
});
