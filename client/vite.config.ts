import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the Socket.IO + REST traffic is proxied to the Node server on :3001.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/socket.io': { target: 'http://localhost:3001', ws: true },
      '/api': 'http://localhost:3001',
    },
  },
});
