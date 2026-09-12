import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Dev server proxies the API so the UI runs against a local service.
    proxy: { '/api': 'http://localhost:3002' },
  },
  build: { outDir: 'dist' },
});
