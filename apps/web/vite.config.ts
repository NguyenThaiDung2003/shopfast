import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      // Socket.IO theo dõi đơn realtime (F02).
      '/socket.io': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
