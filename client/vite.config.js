import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Keep @decartai/sdk out of the dep optimizer so its frame-metadata
  // Worker (new URL("./frame-metadata-worker.js", import.meta.url)) still
  // resolves next to the real package file, not .vite/deps.
  optimizeDeps: {
    exclude: ['@decartai/sdk'],
  },
  worker: {
    format: 'es',
  },
  server: {
    // Bind IPv4 explicitly — on this Windows hosts setup, browsers often
    // hit 127.0.0.1 while Vite's default localhost is IPv6-only.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
});
