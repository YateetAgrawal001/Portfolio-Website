import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:5080' } },
  build: { chunkSizeWarningLimit: 600 }, // three.js, already split into the lazy Game chunk

});
