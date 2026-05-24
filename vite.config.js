import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // New deploys activate immediately instead of stranding the user on a
      // stale cached version — the #1 service-worker footgun.
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['logo.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Life Tracker',
        short_name: 'Life Tracker',
        description: 'Personal task and notes tracker',
        theme_color: '#0D9488',
        background_color: '#FAFAF9',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache only the static build shell (JS/CSS/HTML/fonts/icons).
        // A resumed or offline navigation falls back to the cached index.html
        // instead of a white "no internet" page.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
        navigateFallback: '/index.html',
        // Never serve a cached app shell for Supabase API calls.
        navigateFallbackDenylist: [/^\/api/, /supabase/],
        // New SW takes over open clients immediately (pairs with autoUpdate).
        skipWaiting: true,
        clientsClaim: true,
        // No runtimeCaching: we deliberately never cache the Supabase origin
        // (auth/REST/realtime/storage) to avoid stale-data and stale-auth bugs.
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
  },
})
