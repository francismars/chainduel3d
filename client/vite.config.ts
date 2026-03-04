import { defineConfig } from 'vite';
import path from 'path';
import { VitePWA } from 'vite-plugin-pwa';

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
    plugins: [
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['pwa-icon.svg', 'pwa-maskable.svg'],
        manifest: {
          id: '/',
          name: 'CHAINDUEL3D',
          short_name: 'ChainDuel3D',
          description: 'Fast-paced Bitcoin chain racing game.',
          theme_color: '#0a0a0a',
          background_color: '#0a0a0a',
          display: 'standalone',
          orientation: 'landscape',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-icon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'maskable',
            },
          ],
        },
      }),
    ],
  };
});
