import { useEffect } from 'react'
import { TextSelection } from '@tiptap/pm/state'
import { liftListItem as pmLiftListItem } from '@tiptap/pm/schema-list'
import { getListDepthAt, getListItemTypeAt } from '../utils/listHelpers'

/**
 * Repairs alignment, list depth, and highlight marks after ProseMirror paste.
 *
 * Accepts the shared pasteInfoRef and pendingPasteFixRef that are written by
 * the editorProps.transformPasted and editorProps.handlePaste callbacks in
 * useEditorSetup, then wires the transaction listener that reads them.
 */
export function usePasteAlignFix(editor, pasteInfoRef, pendingPasteFixRef) {
  useEffect(() => {
    if (!editor) return
    const handleTransaction = ({ transaction }) => {
      const isPasteMeta =
        transaction.getMeta('paste') === true || transaction.getMeta('uiEvent') === 'paste'
      const isPending = pendingPasteFixRef.current
      if (!isPasteMeta && !isPending) return
      const info = pasteInfoRef.current
      if (!info?.isPmSlice || !info.summary?.length) {
        pendingPasteFixRef.current = false
        return
      }
      if (info.applied) return
      const { view } = editor
      const steps = transaction.mapping?.maps ?? []
      const firstStep = steps[0]
      const insertStart = firstStep ? firstStep.ranges[0] : null
      const insertOldSize = firstStep ? firstStep.ranges[1] : null
      const insertNewSize = firstStep ? firstStep.ranges[2] : null
      if (insertStart === null || insertOldSize === null || insertNewSize === null) {
        pendingPasteFixRef.current = false
        return
      }
      const mappedStart = insertStart
      const mappedEnd = insertStart + Math.max(insertNewSize, 0)
      const expectedCount = info.summary.length

      const applyFixes = () => {
        if (!view || view.isDestroyed) return
        const { state, dispatch } = view
        const summary = info.summary ?? []
        const targets = []
        state.doc.nodesBetween(
          mappedStart,
          Math.min(mappedEnd, state.doc.content.size),
          (node, pos) => {
            if (node.type?.name !== 'paragraph' && node.type?.name !== 'heading') return
            targets.push({ node, pos })
          },
        )
        const limit = Math.min(expectedCount, summary.length, targets.length)
        const tr = state.tr.setMeta('addToHistory', false)
        for (let i = 0; i < limit; i += 1) {
          const expectedAlign = summary[i]?.align ?? 'left'
          const target = targets[i]
          if (!target) continue
          const nextAttrs = { ...target.node.attrs }
          if (!expectedAlign || expectedAlign === 'left') {
            if (nextAttrs.textAlign != null) delete nextAttrs.textAlign
          } else {
            nextAttrs.textAlign = expectedAlign
          }
          tr.setNodeMarkup(target.pos, undefined, nextAttrs)
        }
        if (tr.docChanged) dispatch(tr)

        const liftListItemWithoutHistory = (targetPos, itemTypeName) => {
          const nodeType = view.state.schema.nodes[itemTypeName]
          if (!nodeType) return false
          const selectionState = view.state.apply(
            view.state.tr.setSelection(TextSelection.create(view.state.doc, targetPos)),
          )
          let lifted = false
          const command = pmLiftListItem(nodeType)
          const applied = command(selectionState, (liftTr) => {
            if (!liftTr.docChanged) return
            liftTr.setMeta('addToHistory', false)
            dispatch(liftTr)
            lifted = true
          })
          return Boolean(applied && lifted)
        }

        let currentState = view.state
        for (let i = 0; i < limit; i += 1) {
          const expectedDepth = summary[i]?.listDepth ?? 0
          let currentTargets = []
          currentState.doc.nodesBetween(
            mappedStart,
            Math.min(mappedEnd, currentState.doc.content.size),
            (node, pos) => {
              if (node.type?.name !== 'paragraph' && node.type?.name !== 'heading') return
              currentTargets.push({ node, pos })
            },
          )
          let currentTarget = currentTargets[i]
          if (!currentTarget) continue
          let actualDepth = getListDepthAt(currentState, currentTarget.pos + 1)
          let guard = 0
          while (actualDepth > expectedDepth && guard < 10) {
            const itemType = getListItemTypeAt(currentState, currentTarget.pos + 1)
            if (!itemType) break
            const didLift = liftListItemWithoutHistory(currentTarget.pos + 1, itemType)
            if (!didLift) break
            currentState = editor.view.state
            currentTargets = []
            currentState.doc.nodesBetween(
              mappedStart,
              Math.min(mappedEnd, currentState.doc.content.size),
              (node, pos) => {
                if (node.type?.name !== 'paragraph' && node.type?.name !== 'heading') return
                currentTargets.push({ node, pos })
              },
            )
            currentTarget = currentTargets[i]
            if (!currentTarget) break
            actualDepth = getListDepthAt(currentState, currentTarget.pos + 1)
            guard += 1
          }
        }

        // Re-apply highlight marks exactly as they existed in the clipboard.
        const highlightState = view.state
        const highlightType = highlightState.schema.marks.highlight
        if (highlightType) {
          const highlightTargets = []
          highlightState.doc.nodesBetween(
            mappedStart,
            Math.min(mappedEnd, highlightState.doc.content.size),
            (node, pos) => {
              if (node.type?.name !== 'paragraph' && node.type?.name !== 'heading') return
              highlightTargets.push({ node, pos })
            },
          )
          const highlightTr = highlightState.tr.setMeta('addToHistory', false)
          for (let i = 0; i < Math.min(summary.length, highlightTargets.length); i += 1) {
            const target = highlightTargets[i]
            if (!target) continue
            const expectedHighlights = summary[i]?.highlights ?? []
            const expectedText = summary[i]?.text ?? ''
            const actualText = target.node.textContent?.replace(/\s+/g, ' ').trim() ?? ''
            if (actualText !== expectedText) continue
            const nodeStart = target.pos + 1
            const nodeEnd = nodeStart + target.node.content.size
            highlightTr.removeMark(nodeStart, nodeEnd, highlightType)
            for (const span of expectedHighlights) {
              const spanFrom = nodeStart + span.from
              const spanTo = nodeStart + span.to
              if (spanFrom >= nodeEnd || spanTo > nodeEnd) continue
              const mark = highlightType.create({ color: span.color })
              highlightTr.addMark(spanFrom, spanTo, mark)
            }
          }
          if (highlightTr.docChanged) view.dispatch(highlightTr)
        }

        pasteInfoRef.current = {
          summary: null,
          preFrom: null,
          preTo: null,
          isPmSlice: false,
          ts: 0,
          applied: false,
        }
        pendingPasteFixRef.current = false
      }

      pasteInfoRef.current = { ...pasteInfoRef.current, applied: true }
      setTimeout(applyFixes, 0)
    }

    editor.on('transaction', handleTransaction)
    return () => editor.off('transaction', handleTransaction)
  }, [editor, pasteInfoRef, pendingPasteFixRef])
}
