import { Component } from 'react'

// Palette mirrors DESIGN.md. Inlined so the fallback renders even if a
// stylesheet failed to load during a fragile resume/re-init.
const styles = {
  wrap: {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16px',
    padding: '24px',
    background: '#FAFAF9',
    color: '#1C1917',
    fontFamily: "'Instrument Sans', system-ui, -apple-system, sans-serif",
    textAlign: 'center',
  },
  heading: { margin: 0, fontSize: '1.25rem', fontWeight: 600 },
  body: { margin: 0, maxWidth: '32ch', color: '#57534E', fontSize: '0.9375rem', lineHeight: 1.5 },
  button: {
    marginTop: '4px',
    padding: '10px 20px',
    borderRadius: '8px',
    border: 'none',
    background: '#0D9488',
    color: '#FFFFFF',
    fontSize: '0.9375rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
}

/**
 * Root error boundary. A thrown error during render/re-init would otherwise
 * leave a permanent white screen (the "must force-close the app" symptom on
 * Android). This shows a recoverable screen instead and tears down the splash
 * so the message is visible.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    // Make sure the boot splash isn't covering the fallback.
    if (typeof window !== 'undefined' && window.__removeAppSplash) {
      window.__removeAppSplash()
    }
    console.error('App crashed:', error, info?.componentStack)
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div style={styles.wrap} role="alert">
        <h1 style={styles.heading}>Something went wrong</h1>
        <p style={styles.body}>
          The app hit an unexpected error. Reloading usually fixes it.
        </p>
        <button type="button" style={styles.button} onClick={this.handleReload}>
          Reload
        </button>
      </div>
    )
  }
}

export default ErrorBoundary
