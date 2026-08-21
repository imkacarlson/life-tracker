import { useState } from 'react'
import { useLibrarySuggestions } from '../../hooks/useLibrarySuggestions'
import { SCOPE_WORDS } from '../../utils/librarySuggestions'
import NewLibraryThingModal from './NewLibraryThingModal'

/**
 * "Worth a topic?" — what the app noticed, and a door to make your own.
 *
 * WHY THIS IS A PANEL AND NOT PART OF THE PAGE. libraryCatalog.ts guarantees
 * that no model writes a sentence of its own into a Library page, and a
 * suggestion's `why` IS a model-written sentence. Beside the page it can be
 * that; inside the page it could not. Suggestion cards are also CONTROLS rather
 * than content — they should never end up in stored page JSON, in an export, or
 * as residue once dismissed.
 *
 * WHERE IT APPEARS. The suggestion level matches the page level: Lately is
 * Library-wide so it offers SECTIONS; a section's front page offers TOPICS in
 * that section. Nowhere else — not on a topic page, not on a capture, not in a
 * tracker.
 *
 * IT NEVER CREATES ANYTHING BY ITSELF. Every row here is an offer with a button
 * on it. Rules 1 and 2 — sections and topics exist only because the user made
 * one — hold exactly as before.
 */
function LibrarySuggestions({ scope, sectionId = null, userId, onCreate }) {
  const { slots, dismiss, markAccepted } = useLibrarySuggestions({ userId, scope, sectionId })
  const [modalOpen, setModalOpen] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)

  const words = SCOPE_WORDS[scope] ?? SCOPE_WORDS.topic
  const busy = busyId !== null

  const create = async (title, suggestionId) => {
    setBusyId(suggestionId ?? 'new')
    setError(null)
    try {
      const created = await onCreate?.({ scope, sectionId, title })
      if (!created) {
        setError(`Couldn’t make that ${words.noun}. Try again in a moment.`)
        return
      }
      // Only once it exists. A suggestion spent on a failed insert would vanish
      // with nothing to show for it.
      if (suggestionId) markAccepted(suggestionId)
      setModalOpen(false)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="library-suggestions" aria-label={`Worth a ${words.noun}?`}>
      <h2 className="library-suggestions-heading">Worth a {words.noun}?</h2>

      <ul className="library-suggestion-grid">
        {slots.map((slot) =>
          slot.kind === 'suggestion' ? (
            <li key={slot.suggestion.id} className="library-suggestion-card">
              <h3 className="library-suggestion-title">{slot.suggestion.title}</h3>
              {slot.suggestion.why ? (
                <p className="library-suggestion-why">{slot.suggestion.why}</p>
              ) : null}
              <div className="library-suggestion-actions">
                <button
                  type="button"
                  className="library-suggestion-make"
                  disabled={busy}
                  onClick={() => create(slot.suggestion.title, slot.suggestion.id)}
                >
                  {busyId === slot.suggestion.id ? 'Making…' : words.make}
                </button>
                <button
                  type="button"
                  className="ghost library-suggestion-dismiss"
                  disabled={busy}
                  onClick={() => dismiss(slot.suggestion.id)}
                >
                  Not interested
                </button>
              </div>
            </li>
          ) : (
            <li key="placeholder" className="library-suggestion-card library-suggestion-placeholder">
              <button
                type="button"
                className="library-suggestion-placeholder-button"
                disabled={busy}
                onClick={() => {
                  setError(null)
                  setModalOpen(true)
                }}
              >
                <span className="library-suggestion-plus" aria-hidden="true">
                  +
                </span>
                <span>Make your own</span>
              </button>
            </li>
          ),
        )}
      </ul>

      {error && !modalOpen ? <p className="library-suggestions-error">{error}</p> : null}

      {modalOpen ? (
        <NewLibraryThingModal
          scope={scope}
          busy={busy}
          error={error}
          onClose={() => setModalOpen(false)}
          onSubmit={(title) => create(title, null)}
        />
      ) : null}
    </section>
  )
}

export default LibrarySuggestions
