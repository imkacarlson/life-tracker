import { useSyncExternalStore } from 'react'
import {
  isActivityRecordingEnabled,
  setActivityRecordingEnabled,
  subscribeActivityRecordingEnabled,
} from '../lib/activityLog'

/** The per-device activity recording switch, as React state. */
export function useActivityRecordingEnabled() {
  const enabled = useSyncExternalStore(
    subscribeActivityRecordingEnabled,
    isActivityRecordingEnabled,
  )
  return [enabled, setActivityRecordingEnabled]
}
