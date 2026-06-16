import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Backend target: localhost for bare-metal dev, http://backend:4000 inside Docker.
const backend = process.env.BACKEND_URL || 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // listen on 0.0.0.0 so the container port is reachable
    port: 5173,
    proxy: {
      '/api': backend,
      '/uploads': backend,
    },
  },
});
