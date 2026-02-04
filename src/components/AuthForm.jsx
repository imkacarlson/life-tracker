import { useState } from 'react'

function AuthForm({ onSignIn, message }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = (event) => {
    event.preventDefault()
    onSignIn(email, password)
  }

  return (
    <div className="app app-auth">
      <h1>Life Tracker</h1>
      <div className="card">
        <h2>Sign in</h2>
        <form onSubmit={handleSubmit} className="form">
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
        <p className="subtle">Need access? Contact the admin.</p>
        {message && <p className="message">{message}</p>}
      </div>
    </div>
  )
}

export default AuthForm
