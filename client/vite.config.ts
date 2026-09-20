import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

// Deployed to GitHub Pages from client/dist at the repo subpath.
// Every data URL is relative to import.meta.env.BASE_URL — see src/data/paths.ts.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/citycamp-sat-change-detection/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    // COGs and GeoJSON are fetched at runtime from public/, never bundled.
    assetsInlineLimit: 0,
  },
  server: { port: 5173 },
});
