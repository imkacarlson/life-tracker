import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { stripClipboardIds } from '../utils/clipboardHelpers'

/**
 * Single owner of the editor's clipboard concern.
 *
 * Copy/cut and paste/drop fidelity comes entirely from correct serialize/parse:
 * every node and mark defines its own `renderHTML`/`parseHTML`, so the standard
 * ProseMirror clipboard pipeline round-trips alignment, highlights, colors,
 * links, nested lists, tables, task lists and images losslessly. There is no
 * post-paste repair pass — content is built correctly the first time.
 *
 * This extension wires the few clipboard hooks we do need:
 *   - `transformCopied`: clear internal block IDs so the clipboard never carries
 *     duplicate IDs into the paste target (EnsureNodeIds assigns fresh ones).
 *   - `handlePaste` / `handleDrop`: route image files to the uploader; all other
 *     content falls through to the standard parse path.
 *
 * Custom editing behaviors (keep-highlight-while-typing, selection/movement
 * shortcuts) live in their own extensions and are intentionally separate.
 */
export const Clipboard = Extension.create({
  name: 'clipboard',

  addOptions() {
    return {
      // Called with a File when a paste or drop carries an image.
      onImageFile: null,
    }
  },

  addProseMirrorPlugins() {
    const onImageFile = this.options.onImageFile

    const pickImageFile = (fileList) => {
      if (!fileList || fileList.length === 0) return null
      return Array.from(fileList).find((file) => file.type.startsWith('image/')) ?? null
    }

    return [
      new Plugin({
        key: new PluginKey('clipboard'),
        props: {
          transformCopied: (slice) => stripClipboardIds(slice),

          handlePaste: (_view, event) => {
            const imageFile = pickImageFile(event.clipboardData?.files)
            if (!imageFile) return false
            event.preventDefault()
            onImageFile?.(imageFile)
            return true
          },

          handleDrop: (_view, event, _slice, moved) => {
            if (moved) return false
            const imageFile = pickImageFile(event.dataTransfer?.files)
            if (!imageFile) return false
            event.preventDefault()
            onImageFile?.(imageFile)
            return true
          },
        },
      }),
    ]
  },
})
