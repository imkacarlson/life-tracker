import { useEffect, useRef } from 'react'
import { supabase } from '../../../lib/supabase'
import { serializeDocToText } from '../../../lib/serializeDoc'
import { useEditorUIStore } from '../../../stores/editorUIStore'
import { scrollElementIntoViewWithToolbar } from '../../../utils/scrollIntoViewWithToolbar'
import {
  buildAiInsertContent,
  findTargetBlockMatch,
  normalizeAiInsertResponse,
  resolveFallbackInsertPos,
  resolveInsertPosCandidatesFromTargetMatch,
  resolveListInsertPlan,
} from '../aiInsertHelpers'

export function useAiInsert({
  editor,
  hasTracker,
  title,
  trackerId,
  editorPanelRef,
  toolbarRef,
}) {
  const inputRef = useRef(null)
  const aiInsertOpen = useEditorUIStore((state) => state.aiInsertOpen)
  const aiInsertLoading = useEditorUIStore((state) => state.aiInsertLoading)
  const aiInsertText = useEditorUIStore((state) => state.aiInsertText)
  const setAiInsertOpen = useEditorUIStore((state) => state.setAiInsertOpen)
  const setAiInsertLoading = useEditorUIStore((state) => state.setAiInsertLoading)
  const setAiInsertText = useEditorUIStore((state) => state.setAiInsertText)

  useEffect(() => {
    if (!aiInsertOpen) return
    requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }, [aiInsertOpen])

  const scrollInsertedContentIntoView = (insertedBlockId) => {
    if (!insertedBlockId) return
    requestAnimationFrame(() => {
      const insertedElement = document.getElementById(insertedBlockId)
      if (!insertedElement) return
      scrollElementIntoViewWithToolbar({
        element: insertedElement,
        container: editorPanelRef.current,
        toolbarEl: toolbarRef.current,
        padding: 24,
      })
    })
  }

  const handleAiInsertSubmit = async () => {
    if (!editor || !hasTracker || aiInsertLoading) return
    const pastedText = aiInsertText.trim()
    if (!pastedText) {
      alert('Paste content before using AI Insert.')
      return
    }

    setAiInsertLoading(true)
    try {
      const provider = localStorage.getItem('ai-provider') || 'anthropic'
      const model = localStorage.getItem('ai-model') || 'claude-sonnet-4-6'
      const pageText = serializeDocToText(editor.getJSON())

      const { data: sessionData } = await supabase.auth.getSession()
      const session = sessionData.session
      if (!session) {
        throw new Error('You must be logged in to use AI Insert')
      }

      const { data, error } = await supabase.functions.invoke('ai-insert', {
        body: {
          provider,
          model,
          pastedText,
          pageTitle: title?.trim() || 'Untitled',
          pageText,
          pageId: trackerId,
        },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      })

      if (error) throw error

      const { targetBlockId, format, items } = normalizeAiInsertResponse(data)
      const insertedContent = buildAiInsertContent(format, items)
      const firstInsertedId = insertedContent[0]?.attrs?.id ?? null

      let inserted = false
      const targetMatch = findTargetBlockMatch(editor, targetBlockId)
      const listInsertPlan = resolveListInsertPlan(editor, targetMatch, insertedContent)
      if (listInsertPlan) {
        inserted = editor
          .chain()
          .focus()
          .insertContentAt(listInsertPlan.pos, listInsertPlan.content)
          .run()
      }

      const candidatePositions = resolveInsertPosCandidatesFromTargetMatch(editor, targetMatch)
      for (const candidatePos of candidatePositions) {
        if (inserted) break
        if (editor.chain().focus().insertContentAt(candidatePos, insertedContent).run()) {
          inserted = true
          break
        }
      }

      if (!inserted) {
        const fallbackPos = resolveFallbackInsertPos(editor)
        inserted = editor.chain().focus().insertContentAt(fallbackPos, insertedContent).run()
      }

      if (!inserted) {
        throw new Error('AI Insert could not find a valid insertion point.')
      }

      scrollInsertedContentIntoView(firstInsertedId)
      setAiInsertOpen(false)
      setAiInsertText('')
    } catch (err) {
      console.error('AI insert failed:', err)
      alert('Failed to insert content: ' + (err.message || String(err)))
    } finally {
      setAiInsertLoading(false)
    }
  }

  return {
    aiInsertModalProps: {
      inputRef,
      open: aiInsertOpen,
      loading: aiInsertLoading,
      text: aiInsertText,
      hasTracker,
      onTextChange: setAiInsertText,
      onClose: () => setAiInsertOpen(false),
      onSubmit: handleAiInsertSubmit,
    },
  }
}
