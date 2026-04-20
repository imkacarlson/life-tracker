import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'

/**
 * Keeps highlighted text highlighted across backspace/delete operations.
 *
 * When the user deletes all highlighted content (cursor moves past the span
 * boundary), the very next typed character still inherits the highlight color.
 * Works alongside inclusive:false (which prevents paste bleed) because
 * appendTransaction only fires for user-input transactions, not paste.
 *
 * handleKeyDown and handleTextInput live here (as ProseMirror plugin props)
 * so they share the plugin-local `preservedHighlight` variable without
 * needing an external ref.
 */
export const HighlightPreserve = Extension.create({
  name: 'highlightPreserve',

  addProseMirrorPlugins() {
    // Plugin-local state: the highlight mark to carry onto the next typed character.
    let preservedHighlight = null

    return [
      new Plugin({
        props: {
          // Navigation keys end the preserve session so that typing after cursor
          // movement does not accidentally inherit a previous highlight color.
          // Backspace/Delete are excluded: appendTransaction handles them.
          handleKeyDown(_view, event) {
            if (event.key.length !== 1) {
              if (!['Shift', 'CapsLock', 'Backspace', 'Delete'].includes(event.key)) {
                preservedHighlight = null
              }
              return false
            }
            if (event.ctrlKey || event.metaKey || event.altKey) {
              preservedHighlight = null
              return false
            }
            return false
          },

          // Intercept text input so the mark is applied in the same transaction as
          // the character insertion — avoiding a two-step dispatch where something
          // can strip the mark between insert and addMark.
          //
          // With inclusive:false on Highlight, $from.marks() at the mark's start
          // boundary excludes the mark, so ProseMirror won't carry it onto text
          // typed to replace a selection. Fix: when a printable key is pressed with
          // a non-empty selection inside a highlight span, pre-load storedMarks
          // (sampled from inside the selection) so the replacement inherits the mark.
          handleTextInput(view, from, to, text) {
            const { state } = view
            const highlightType = state.schema.marks.highlight
            if (!highlightType) return false

            // Chrome/contenteditable sometimes recomposes the entire text node after
            // backspaces, sending e.g. "Expenses due 3" instead of just "3".
            // Diff old vs new text to find which characters are actually new.
            const oldText = from < to ? state.doc.textBetween(from, to, '', '\ufffc') : ''
            let newStart = 0
            while (
              newStart < oldText.length &&
              newStart < text.length &&
              oldText[newStart] === text[newStart]
            ) {
              newStart++
            }
            const newChars = text.slice(newStart)
            if (newChars.length === 0) return false

            const insertPos = from + newStart

            // Case A: character immediately before the insert position is highlighted.
            let highlightToApply = null
            if (insertPos > 1) {
              state.doc.nodesBetween(
                insertPos - 1,
                Math.min(insertPos, state.doc.content.size),
                (node) => {
                  if (!node.isText || highlightToApply) return
                  const h = node.marks.find((m) => m.type === highlightType)
                  if (h) highlightToApply = h
                },
              )
            }

            // Case B: active preserve session — cursor backspaced out of span.
            if (!highlightToApply) highlightToApply = preservedHighlight ?? null

            if (!highlightToApply) return false

            const mark = highlightType.create({ color: highlightToApply.attrs?.color })
            const markFrom = from + newStart
            const markTo = from + text.length
            const tr = state.tr.insertText(text, from, to).addMark(markFrom, markTo, mark)
            view.dispatch(tr)
            return true
          },
        },

        appendTransaction(transactions, oldState, newState) {
          const tr = transactions[0]
          if (!tr || !tr.docChanged) return null
          if (tr.getMeta('paste') || tr.getMeta('uiEvent') === 'paste') return null
          if (tr.getMeta('history$')) return null
          if (!newState.selection.empty) return null
          const highlightType = oldState.schema.marks.highlight
          if (!highlightType) return null

          for (const step of tr.steps) {
            // Skip AddMarkStep / RemoveMarkStep — they have a .mark property.
            // This prevents our own applyFixes dispatch from triggering this.
            if (step.mark !== undefined) continue
            const from = step.from
            const to = step.to ?? step.from
            if (typeof from !== 'number') continue

            if (from < to) {
              // DELETION (possibly with replacement content in the same step).
              // Gate: deletion must start within a highlight span.
              let foundMark = null
              oldState.doc.nodesBetween(
                from,
                Math.min(from + 1, to, oldState.doc.content.size),
                (node) => {
                  if (!node.isText || foundMark) return
                  const h = node.marks.find((m) => m.type === highlightType)
                  if (h) foundMark = h
                },
              )
              if (!foundMark) continue

              preservedHighlight = foundMark

              // If the step also inserted replacement content, highlight it directly.
              const insertedSize = step.slice?.content?.size ?? 0
              if (insertedSize > 0) {
                const mark = highlightType.create({ color: foundMark.attrs?.color })
                return newState.tr.addMark(from, from + insertedSize, mark)
              }
              // Pure deletion: preserve session active; next insertion handled in handleTextInput.
              return null
            }
          }
          return null
        },
      }),
    ]
  },
})
