import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { withTimeout } from '../utils/promiseTimeout'

const getUserId = (value) => value?.user?.id ?? null

// On a fragile resume getSession() can hang, which used to pin the loading
// state (and the splash) forever. Cap it: on timeout we treat the user as
// signed-out with a retry message. onAuthStateChange still fires later if the
// real session resolves, so a recovered network self-heals.
const GET_SESSION_TIMEOUT_MS = 8000
const GET_SESSION_TIMEOUT_RESULT = {
  data: { session: null },
  error: { message: 'Connection timed out. Check your network and reload.' },
}

export const useAuth = () => {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let mounted = true

    withTimeout(
      supabase.auth.getSession(),
      GET_SESSION_TIMEOUT_MS,
      () => GET_SESSION_TIMEOUT_RESULT,
    ).then(({ data, error }) => {
      if (!mounted) return
      if (error) setMessage(error.message)
      setSession((prev) => {
        const prevId = getUserId(prev)
        const nextId = getUserId(data.session)
        if (prevId === nextId) return prev
        return data.session
      })
      setLoading(false)
    })

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession((prev) => {
        const prevId = getUserId(prev)
        const nextId = getUserId(nextSession)
        if (prevId === nextId) return prev
        return nextSession
      })
      setLoading(false)
    })

    return () => {
      mounted = false
      authListener.subscription.unsubscribe()
    }
  }, [])

  const signIn = async (email, password) => {
    setMessage('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setMessage(error.message)
  }

  const signOut = async () => {
    setMessage('')
    await supabase.auth.signOut()
  }

  return {
    session,
    loading,
    message,
    setMessage,
    signIn,
    signOut,
    userId: getUserId(session),
  }
}
