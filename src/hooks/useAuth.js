import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const getUserId = (value) => value?.user?.id ?? null

export const useAuth = () => {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(({ data, error }) => {
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
