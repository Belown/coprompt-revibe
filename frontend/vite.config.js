import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' keeps every URL relative, so the build works from any folder (GitHub Pages project sites included).
// Port 8000 for dev and preview: it is the local origin the sync backend allows by default (ALLOWED_ORIGINS).
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 8000, strictPort: true },
  preview: { port: 8000, strictPort: true },
});
