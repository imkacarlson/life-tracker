import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import './App.css'

function App() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  const missingEnv = !supabaseUrl || !supabaseAnonKey

  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [items, setItems] = useState([])
  const [newItem, setNewItem] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (missingEnv) {
      setLoading(false)
      return
    }

    let mounted = true

    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return
      if (error) setMessage(error.message)
      setSession(data.session)
      setLoading(false)
    })

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setLoading(false)
    })

    return () => {
      mounted = false
      authListener.subscription.unsubscribe()
    }
  }, [missingEnv])

  useEffect(() => {
    if (!session) return
    loadItems()
  }, [session])

  async function handleSignIn(event) {
    event.preventDefault()
    setMessage('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setMessage(error.message)
  }

  async function handleSignOut() {
    setMessage('')
    await supabase.auth.signOut()
  }

  async function loadItems() {
    setMessage('')
    const { data, error } = await supabase
      .from('test_items')
      .select('id, content, created_at')
      .order('created_at', { ascending: false })

    if (error) {
      setMessage(error.message)
      return
    }

    setItems(data ?? [])
  }

  async function handleAddItem(event) {
    event.preventDefault()
    if (!newItem.trim()) return

    setSaving(true)
    setMessage('')

    const { error } = await supabase.from('test_items').insert({
      content: newItem.trim(),
      user_id: session.user.id,
    })

    setSaving(false)

    if (error) {
      setMessage(error.message)
      return
    }

    setNewItem('')
    loadItems()
  }

  if (missingEnv) {
    return (
      <div className="app">
        <h1>Life Tracker</h1>
        <div className="card">
          <p>Missing Supabase environment variables.</p>
          <p>Set these in a <code>.env.local</code> file, then restart the dev server:</p>
          <ul>
            <li>VITE_SUPABASE_URL</li>
            <li>VITE_SUPABASE_ANON_KEY</li>
          </ul>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="app">
        <h1>Life Tracker</h1>
        <div className="card">Loading...</div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="app">
        <h1>Life Tracker</h1>
        <div className="card">
          <h2>Sign in</h2>
          <form onSubmit={handleSignIn} className="form">
            <label className="label">
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
              />
            </label>
            <label className="label">
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Your password"
                required
              />
            </label>
            <div className="actions">
              <button type="submit">Sign in</button>
            </div>
          </form>
          {message && <p className="message">{message}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Life Tracker</h1>
          <p className="subtle">Signed in as {session.user.email}</p>
        </div>
        <button className="secondary" onClick={handleSignOut}>
          Log out
        </button>
      </header>

      <div className="card">
        <h2>Test items</h2>
        <p className="subtle">
          This is a temporary table for Phase 1. Create a <code>test_items</code> table in Supabase with
          columns: <code>id</code>, <code>user_id</code>, <code>content</code>, <code>created_at</code>.
        </p>

        <form onSubmit={handleAddItem} className="form-inline">
          <input
            type="text"
            value={newItem}
            onChange={(event) => setNewItem(event.target.value)}
            placeholder="Add a test item"
          />
          <button type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Add'}
          </button>
          <button type="button" className="secondary" onClick={loadItems}>
            Refresh
          </button>
        </form>

        {message && <p className="message">{message}</p>}

        <ul className="list">
          {items.map((item) => (
            <li key={item.id}>
              <span>{item.content}</span>
              <span className="timestamp">
                {item.created_at ? new Date(item.created_at).toLocaleString() : ''}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export default App
