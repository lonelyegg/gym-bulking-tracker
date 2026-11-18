import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

// GitHub Pages serves the app from /<repo-name>/. Override with BASE_PATH=/ for other hosts.
const base = process.env.BASE_PATH ?? '/gym-bulking-tracker/';

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png', 'icon.svg', 'sw-extra.js'],
      manifest: {
        name: 'Gym Bulking Tracker',
        short_name: 'Bulk',
        description: 'Personal workout and bulking tracker',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0e1014',
        theme_color: '#0e1014',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        // Adds a notification-click handler that focuses the app.
        importScripts: ['sw-extra.js'],
        // Never cache calls to Apps Script.
        navigateFallbackDenylist: [/^\/macros\//],
      },
    }),
  ],
  test: {
    environment: 'node',
  },
});
