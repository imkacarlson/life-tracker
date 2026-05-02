import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.{js,jsx,ts,tsx}', 'supabase/functions/**/*.test.{js,jsx,ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'docmost/**'],
    env: {
      // Stubs to prevent Supabase client from crashing at import time.
      // Unit tests never hit the network — these just keep the module loader happy
      // when a tested file transitively imports src/lib/supabase.js.
      VITE_SUPABASE_URL: 'http://stub.local',
      VITE_SUPABASE_ANON_KEY: 'stub-key',
    },
  },
})
