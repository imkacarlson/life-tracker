import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { EMPTY_DOC } from '../utils/constants'
import { normalizeContent, sanitizeContentForSave } from '../utils/contentHelpers'

export const useSettings = (userId, hydrateContentWithSignedUrls) => {
  const [settingsMode, setSettingsMode] = useState(null)
  const [settingsRow, setSettingsRow] = useState(null)
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [templateSaveStatus, setTemplateSaveStatus] = useState('Saved')
  const [settingsContentVersion, setSettingsContentVersion] = useState(0)
  const [message, setMessage] = useState('')

  const settingsSaveTimerRef = useRef(null)
  const settingsRowRef = useRef(null)
  const templateContentRef = useRef(EMPTY_DOC)

  useEffect(() => {
    settingsRowRef.current = settingsRow
  }, [settingsRow])

  useEffect(() => {
    return () => {
      if (settingsSaveTimerRef.current) {
        clearTimeout(settingsSaveTimerRef.current)
      }
    }
  }, [])

  const loadSettings = useCallback(async () => {
    if (!userId) return
    setSettingsLoading(true)
    setMessage('')
    const { data, error } = await supabase
      .from('settings')
      .select('id, user_id, daily_template_content, created_at, updated_at')
      .eq('user_id', userId)
      .maybeSingle()

    if (error) {
      setMessage(error.message)
      setSettingsLoading(false)
      return
    }

    let row = data
    if (!row) {
      const { data: created, error: createError } = await supabase
        .from('settings')
        .insert({ user_id: userId, daily_template_content: EMPTY_DOC })
        .select()
        .single()

      if (createError) {
        setMessage(createError.message)
        setSettingsLoading(false)
        return
      }
      row = created
    }

    const hydrated = await hydrateContentWithSignedUrls(
      normalizeContent(row.daily_template_content),
    )
    templateContentRef.current = hydrated
    setSettingsRow(row)
    setSettingsContentVersion((version) => version + 1)
    setSettingsLoading(false)
  }, [userId, hydrateContentWithSignedUrls])

  useEffect(() => {
    if (!userId) return
    loadSettings()
  }, [userId, loadSettings])

  const scheduleSettingsSave = useCallback(
    (nextContent) => {
      if (!userId) return
      if (settingsSaveTimerRef.current) {
        clearTimeout(settingsSaveTimerRef.current)
      }

      const payload = {
        daily_template_content: sanitizeContentForSave(nextContent),
        updated_at: new Date().toISOString(),
      }

      setTemplateSaveStatus('Saving...')
      templateContentRef.current = nextContent

      settingsSaveTimerRef.current = setTimeout(async () => {
        const existing = settingsRowRef.current
        if (!existing?.id) {
          const { data, error } = await supabase
            .from('settings')
            .insert({ user_id: userId, ...payload })
            .select()
            .single()

          if (error) {
            setMessage(error.message)
            setTemplateSaveStatus('Error')
            return
          }

          setSettingsRow(data)
          setTemplateSaveStatus('Saved')
          return
        }

        const { error } = await supabase
          .from('settings')
          .update(payload)
          .eq('id', existing.id)

        if (error) {
          setMessage(error.message)
          setTemplateSaveStatus('Error')
          return
        }

        setSettingsRow((prev) => (prev ? { ...prev, ...payload } : prev))
        setTemplateSaveStatus('Saved')
      }, 2000)
    },
    [userId],
  )

  const openSettings = () => {
    setSettingsMode('hub')
    if (!settingsRow) {
      loadSettings()
    }
  }

  const closeSettings = () => {
    setSettingsMode(null)
  }

  const openDailyTemplate = () => {
    setSettingsMode('daily-template')
    if (!settingsRow) {
      loadSettings()
    }
  }

  const backToSettingsHub = () => {
    setSettingsMode('hub')
  }

  return {
    settingsMode,
    setSettingsMode,
    settingsRow,
    settingsLoading,
    templateSaveStatus,
    setTemplateSaveStatus,
    settingsContentVersion,
    templateContentRef,
    message,
    setMessage,
    scheduleSettingsSave,
    openSettings,
    closeSettings,
    openDailyTemplate,
    backToSettingsHub,
  }
}
