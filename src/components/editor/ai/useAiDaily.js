import { supabase } from '../../../lib/supabase'
import { useEditorUIStore } from '../../../stores/editorUIStore'
import {
  hasMeaningfulTemplate,
  hydrateContentWithSignedUrls,
  normalizeTemplateContent,
} from '../templateHelpers'
import { buildDailyInsertContent } from './dailyDocBuilders'

export function useAiDaily({
  editor,
  notebookId,
  sectionId,
  pageId,
  allPages,
  dailySourcePage,
  loadPageContentById,
  userId,
}) {
  const loadDailyTemplateNodes = async () => {
    if (!userId) return []
    const { data, error } = await supabase
      .from('settings')
      .select('daily_template_content')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) {
      console.error('Failed to load daily template:', error)
      return []
    }
    const doc = normalizeTemplateContent(data?.daily_template_content)
    if (!hasMeaningfulTemplate(doc)) return []
    const hydrated = await hydrateContentWithSignedUrls(doc, supabase)
    const nodes = Array.isArray(hydrated.content) ? hydrated.content : []
    return JSON.parse(JSON.stringify(nodes))
  }

  const handleGenerateToday = async () => {
    const { aiLoading, aiInsertLoading, setAiLoading } = useEditorUIStore.getState()
    if (!editor || aiLoading || aiInsertLoading) return
    setAiLoading(true)
    try {
      const provider = localStorage.getItem('ai-provider') || 'anthropic'
      const model = localStorage.getItem('ai-model') || 'claude-sonnet-4-6'
      const selectedDate = useEditorUIStore.getState().aiDailyDate
      const today = selectedDate.toLocaleDateString('en-CA')
      const dayOfWeek = selectedDate.toLocaleDateString('en-US', { weekday: 'long' })

      const sourcePage =
        dailySourcePage ?? (allPages || []).find((page) => page.isDailySource) ?? null
      if (!sourcePage) {
        alert('Set a tracker page first (Pages sidebar > Set tracker).')
        return
      }

      let sourceContent = null
      if (sourcePage.id === pageId) {
        sourceContent = editor.getJSON()
      } else if (loadPageContentById) {
        sourceContent = await loadPageContentById(sourcePage.id)
      }

      if (!sourceContent || typeof sourceContent !== 'object') {
        throw new Error('Tracker page content could not be loaded.')
      }

      const sourcePagesForModel = [
        {
          title: sourcePage.title,
          pageId: sourcePage.id,
          content: sourceContent,
        },
      ]

      const { data: sessionData } = await supabase.auth.getSession()
      const session = sessionData.session
      if (!session) {
        throw new Error('You must be logged in to use AI Daily')
      }

      const { data, error } = await supabase.functions.invoke('generate-daily', {
        body: { provider, model, trackerPages: sourcePagesForModel, today, dayOfWeek },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      })
      if (error) throw error
      const asapTasks = Array.isArray(data?.asap)
        ? data.asap
        : Array.isArray(data?.tasks)
          ? data.tasks
          : []
      const fyiTasks = Array.isArray(data?.fyi) ? data.fyi : []
      let templateNodes = []
      try {
        templateNodes = await loadDailyTemplateNodes()
      } catch (err) {
        console.error('Failed to load daily template:', err)
        templateNodes = []
      }
      if (asapTasks.length === 0 && fyiTasks.length === 0 && templateNodes.length === 0) {
        alert('No tasks generated. Check your tracker pages have content.')
        return
      }

      const insertContent = buildDailyInsertContent({
        selectedDate,
        asapTasks,
        fyiTasks,
        templateNodes,
        warning: data?.warning,
        notebookId,
        sectionId,
        sourcePageId: sourcePage.id,
      })
      if (!editor.state.selection.empty) {
        editor.commands.setTextSelection(editor.state.selection.to)
      }
      editor.chain().focus().insertContent(insertContent).run()
    } catch (err) {
      console.error('AI generation failed:', err)
      alert('Failed to generate tasks: ' + (err.message || String(err)))
    } finally {
      setAiLoading(false)
    }
  }

  return { handleGenerateToday }
}
