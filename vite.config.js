import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' keeps every URL relative, so the build works from any folder (GitHub Pages project sites included)
export default defineConfig({
  base: './',
  plugins: [react()],
  preview: { port: 8765, strictPort: true },
});
