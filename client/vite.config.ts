import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig(() => {
  const backendPort = process.env.VITE_BACKEND_PORT || '3000';
  return {
    resolve: {
      alias: {
        shared: path.resolve(__dirname, '../shared'),
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': `http://localhost:${backendPort}`,
        '/ws': {
          target: `ws://localhost:${backendPort}`,
          ws: true,
        },
      },
    },
  };
});
