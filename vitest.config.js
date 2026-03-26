import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['e2e/**', 'node_modules/**'],
    env: {
      // Stubs to prevent Supabase client from crashing at import time.
      // Unit tests never hit the network — these just keep the module loader happy
      // when a tested file transitively imports src/lib/supabase.js.
      VITE_SUPABASE_URL: 'http://stub.local',
      VITE_SUPABASE_ANON_KEY: 'stub-key',
    },
  },
})
