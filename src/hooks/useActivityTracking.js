import { useEffect } from 'react'
import {
  logActivity,
  setActivityPage,
  setActivityUser,
  startActivityLog,
} from '../lib/activityLog'
import { syncSessionRecording } from '../lib/sessionRecorder'
import { diffDocSummaries, summarizeDoc, truncate } from '../utils/activityHelpers'
import { useActivityRecordingEnabled } from './useActivityRecordingEnabled'

// An edit "burst" ends after this long without changes; one 'edit' event then
// describes the whole burst instead of one row per keystroke.
const EDIT_IDLE_MS = 3000

/**
 * Feeds the activity log from React state: who is signed in, which page is
 * open (and for how long), and what changed in the editor.
 */
export function useActivityTracking({ userId, activePage, editor }) {
  useEffect(() => {
    startActivityLog()
  }, [])

  useEffect(() => {
    setActivityUser(userId)
  }, [userId])

  // Screen recording follows the same on/off switch as the activity log.
  const [recordingEnabled] = useActivityRecordingEnabled()
  useEffect(() => {
    syncSessionRecording({ userId, enabled: recordingEnabled })
  }, [userId, recordingEnabled])

  const pageId = activePage?.id ?? null
  const pageTitle = activePage?.title ?? null

  // page_open / page_leave pairs, so time spent on a page can be measured.
  useEffect(() => {
    setActivityPage(pageId)
    if (!pageId) return undefined
    const openedAt = Date.now()
    logActivity('page_open', { title: truncate(pageTitle, 120) }, { pageId })
    return () => {
      logActivity('page_leave', { duration_ms: Date.now() - openedAt }, { pageId })
    }
    // pageTitle is left out on purpose: renaming a page is not opening it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId])

  useEffect(() => {
    if (!editor) return undefined

    // State of the current burst: the doc before it started, the latest doc,
    // and which page it belongs to (captured now, since the page can change
    // before the burst is written).
    let burst = null
    let timer = null

    const finishBurst = () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (!burst) return
      const { startDoc, lastDoc, burstPageId, steps, startedAt } = burst
      burst = null
      try {
        const diff = diffDocSummaries(summarizeDoc(startDoc), summarizeDoc(lastDoc))
        logActivity(
          'edit',
          { ...diff, transactions: steps, duration_ms: Date.now() - startedAt },
          { pageId: burstPageId },
        )
      } catch {
        // A malformed doc must never break editing.
      }
    }

    // 'update' only fires for real edits: loading a page or applying a remote
    // change dispatches with preventUpdate, so those are not counted.
    const handleUpdate = ({ transaction }) => {
      if (!burst) {
        burst = {
          startDoc: transaction.before,
          lastDoc: transaction.doc,
          burstPageId: pageId,
          steps: 0,
          startedAt: Date.now(),
        }
      }
      burst.lastDoc = transaction.doc
      burst.steps += 1
      if (timer) clearTimeout(timer)
      timer = setTimeout(finishBurst, EDIT_IDLE_MS)
    }

    editor.on('update', handleUpdate)
    return () => {
      editor.off('update', handleUpdate)
      finishBurst()
    }
  }, [editor, pageId])
}
