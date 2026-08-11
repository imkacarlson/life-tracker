import { useCallback, useEffect } from 'react'
import { isIntentionalReload, setBeforeReloadHandler } from '../../../utils/reloadCoordinator'

export function useSaveLifecycle({ isSaving, flushAllPendingSaves }) {
  const confirmLeaveWhileSaving = useCallback(() => {
    if (!isSaving) return true
    return window.confirm('Changes are still saving. Leave this page anyway?')
  }, [isSaving])

  useEffect(() => {
    const handleBeforeUnload = (event) => {
      flushAllPendingSaves()
      if (isIntentionalReload()) return
      if (!isSaving) return
      event.preventDefault()
      event.returnValue = ''
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushAllPendingSaves()
      }
    }
    const handlePageHide = () => {
      flushAllPendingSaves()
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pagehide', handlePageHide)
    const unsubscribeBeforeReload = setBeforeReloadHandler(flushAllPendingSaves)
    return () => {
      unsubscribeBeforeReload()
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pagehide', handlePageHide)
    }
  }, [isSaving, flushAllPendingSaves])

  return { confirmLeaveWhileSaving }
}
