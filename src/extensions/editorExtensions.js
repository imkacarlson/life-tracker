import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'

export const EnsureNodeIds = Extension.create({
  name: 'ensureNodeIds',
  addProseMirrorPlugins() {
    const types = ['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'table']
    return [
      new Plugin({
        key: new PluginKey('ensureNodeIds'),
        appendTransaction: (transactions, _oldState, newState) => {
          const hasChanges = transactions.some((tr) => tr.docChanged)
          const hasMeta = transactions.some((tr) => tr.getMeta('ensureNodeIds'))
          if (!hasChanges || hasMeta) return

          const tr = newState.tr
          let updated = false
          const seen = new Set()

          newState.doc.descendants((node, pos) => {
            if (!types.includes(node.type.name)) return
            let id = node.attrs?.id
            let createdAt = node.attrs?.created_at
            let nodeUpdated = false

            // Ensure every node has a unique ID for deep linking
            if (!id || seen.has(id)) {
              id = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 10)
              // If the block identity changes, reset creation time.
              createdAt = new Date().toISOString()
              nodeUpdated = true
            }
            seen.add(id)

            // Track creation date for future workflows/analytics.
            if (!createdAt) {
              createdAt = new Date().toISOString()
              nodeUpdated = true
            }

            if (nodeUpdated) {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, id, created_at: createdAt })
              updated = true
            }
          })

          if (!updated) return
          tr.setMeta('ensureNodeIds', true)
          return tr
        },
      }),
    ]
  },
})

export const SecureImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      storagePath: {
        default: null,
      },
    }
  },
})

export const InternalLink = Link.extend({
  addOptions() {
    return {
      ...this.parent?.(),
      onNavigateHash: null,
    }
  },
  addProseMirrorPlugins() {
    const plugins = this.parent?.() ?? []
    const onNavigateHash = this.options.onNavigateHash

    const internalLinkPlugin = new Plugin({
      props: {
        handleClick: (_view, _pos, event) => {
          const target = event.target
          const link = target?.closest?.('a')
          const href = link?.getAttribute?.('href')
          if (!href) return false
          event.preventDefault()
          event.stopPropagation()
          if (href.startsWith('#nb=')) {
            onNavigateHash?.(href)
            return true
          }
          window.open(href, '_blank', 'noopener,noreferrer')
          return true
        },
      },
    })

    return [internalLinkPlugin, ...plugins]
  },
})
