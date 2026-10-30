import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      // Endpoint hạ tầng nằm ngoài /api (ADR-0012).
      '/health': 'http://localhost:3000',
      '/docs': 'http://localhost:3000',
      // Bull Board (ADR-0009).
      '/admin/queues': 'http://localhost:3000',
      // Socket.IO theo dõi đơn realtime (F02).
      '/socket.io': { target: 'ws://localhost:3000', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Test không bao giờ gọi API thật: fetch bị thay bằng fake (src/test/fake-api.ts).
    restoreMocks: true,
  },
});
