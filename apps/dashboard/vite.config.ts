import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4701,
    proxy: {
      '/api': 'http://127.0.0.1:4700',
      '/snapshots': 'http://127.0.0.1:4700',
      '/artifacts': 'http://127.0.0.1:4700',
    },
  },
});
