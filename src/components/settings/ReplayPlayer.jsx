import { useEffect, useRef, useState } from 'react'

/**
 * rrweb-player mounted into a div. The player (and its CSS) is lazy-loaded so
 * it only downloads when a recording is actually opened.
 *
 * @param {{ events: object[], startOffsetMs?: number }} props
 */
function ReplayPlayer({ events, startOffsetMs = 0 }) {
  const mountRef = useRef(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let player = null
    let cancelled = false

    const mount = async () => {
      try {
        const [{ default: RrwebPlayer }] = await Promise.all([
          import('rrweb-player'),
          import('rrweb-player/dist/style.css'),
        ])
        if (cancelled || !mountRef.current) return
        const width = mountRef.current.clientWidth || 360
        player = new RrwebPlayer({
          target: mountRef.current,
          props: {
            events,
            width,
            // Leave room for the player's controls bar (~80px).
            height: Math.round(Math.min(window.innerHeight * 0.6, width * 0.75)),
            autoPlay: false,
            showDebug: false,
            // Keystrokes are custom events; give them a visible tag on the timeline.
            tags: { keydown: '#0D9488' },
          },
        })
        if (startOffsetMs > 0) player.goto(startOffsetMs, false)
      } catch (err) {
        if (!cancelled) setError(`Could not open the player: ${err?.message ?? err}`)
      }
    }
    mount()

    return () => {
      cancelled = true
      player?.$destroy()
    }
  }, [events, startOffsetMs])

  return (
    <div className="replay-player">
      {error ? <p className="recordings-error">{error}</p> : null}
      <div ref={mountRef} />
    </div>
  )
}

export default ReplayPlayer
