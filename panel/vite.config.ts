import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const target = `http://localhost:${process.env.PORT || 3000}`;

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/panel/',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': target,
      '/socket.io': { target, ws: true },
    },
  },
  build: {
    outDir: fileURLToPath(new URL('../server/public/panel', import.meta.url)),
    emptyOutDir: true,
  },
});
