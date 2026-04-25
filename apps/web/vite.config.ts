import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import path from 'node:path'

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  plugins: [
    TanStackRouterVite({ routesDirectory: './src/routes', generatedRouteTree: './src/routeTree.gen.ts' }),
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'icons/*.png'],
      manifest: {
        name: 'Kyomiru',
        short_name: 'Kyomiru',
        description: 'Track your anime and TV show watch history',
        theme_color: '#090c15',
        background_color: '#090c15',
        display: 'standalone',
        start_url: '/library',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api(\/|$)/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.(jpg|jpeg|png|webp|avif)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images',
              expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
          {
            urlPattern: /\/api\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api',
              networkTimeoutSeconds: 5,
            },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
})
