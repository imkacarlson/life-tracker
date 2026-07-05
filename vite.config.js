import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Prompt lifecycle: a new SW waits until the user clicks "Refresh" in the
      // in-app banner (see PwaUpdatePrompt.jsx), instead of silently activating.
      // This avoids reloading mid-edit while still guaranteeing new deploys
      // reach the user (hourly + on-focus update checks drive the prompt).
      registerType: 'prompt',
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
        // Do NOT set skipWaiting/clientsClaim: in the prompt lifecycle the new
        // SW must stay `waiting` until the user clicks Refresh, at which point
        // updateServiceWorker(true) sends SKIP_WAITING and reloads. Self-
        // activating here would defeat the prompt.
        // No runtimeCaching: we deliberately never cache the Supabase origin
        // (auth/REST/realtime/storage) to avoid stale-data and stale-auth bugs.
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
  },
})
