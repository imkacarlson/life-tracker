import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Missing Supabase env vars. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
}

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '')

export const SUPABASE_URL = supabaseUrl ?? ''
export const SUPABASE_ANON_KEY = supabaseAnonKey ?? ''

// supabase.auth.getSession() is async, which is useless inside an unload handler:
// the tab is already tearing down and there is no next tick to await. Mirror the
// token here so the keepalive save in useSaveQueue can read it synchronously.
let accessToken = null

supabase.auth.onAuthStateChange((_event, session) => {
  accessToken = session?.access_token ?? null
})

export const getAccessTokenSync = () => accessToken
