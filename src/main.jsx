import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import PwaUpdatePrompt from './components/PwaUpdatePrompt.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    {/* Sibling of ErrorBoundary: if a bad deploy crashes App into the
        fallback, the update banner still shows so the user can Refresh
        into a fixed build. */}
    <PwaUpdatePrompt />
  </StrictMode>,
)
