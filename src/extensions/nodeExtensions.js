import Paragraph from '@tiptap/extension-paragraph'
import Heading from '@tiptap/extension-heading'
import BulletList from '@tiptap/extension-bullet-list'
import OrderedList from '@tiptap/extension-ordered-list'
import TaskList from '@tiptap/extension-task-list'

const withIdAttribute = (parentAttributes = {}) => ({
  ...parentAttributes,
  id: {
    default: null,
    parseHTML: (element) => element.getAttribute('id'),
    renderHTML: (attributes) => {
      if (!attributes.id) return {}
      return { id: attributes.id }
    },
  },
  created_at: {
    default: null,
    parseHTML: (element) => element.getAttribute('data-created-at'),
    renderHTML: (attributes) => {
      if (!attributes.created_at) return {}
      return { 'data-created-at': attributes.created_at }
    },
  },
})

export const ParagraphWithId = Paragraph.extend({
  addAttributes() {
    return withIdAttribute(this.parent?.())
  },
})

export const HeadingWithId = Heading.extend({
  addAttributes() {
    return withIdAttribute(this.parent?.())
  },
})

export const BulletListWithId = BulletList.extend({
  addAttributes() {
    return withIdAttribute(this.parent?.())
  },
  renderHTML({ HTMLAttributes }) {
    const parent = this.parent?.({ HTMLAttributes }) ?? ['ul', HTMLAttributes, 0]
    if (!HTMLAttributes?.id) return parent
    const [tag, attrs, content] = parent
    return [tag, { ...attrs, id: HTMLAttributes.id }, content]
  },
})

export const OrderedListWithId = OrderedList.extend({
  addAttributes() {
    return withIdAttribute(this.parent?.())
  },
  renderHTML({ HTMLAttributes }) {
    const parent = this.parent?.({ HTMLAttributes }) ?? ['ol', HTMLAttributes, 0]
    if (!HTMLAttributes?.id) return parent
    const [tag, attrs, content] = parent
    return [tag, { ...attrs, id: HTMLAttributes.id }, content]
  },
})

export const TaskListWithId = TaskList.extend({
  addAttributes() {
    return withIdAttribute(this.parent?.())
  },
  renderHTML({ HTMLAttributes }) {
    const parent = this.parent?.({ HTMLAttributes }) ?? ['ul', HTMLAttributes, 0]
    if (!HTMLAttributes?.id) return parent
    const [tag, attrs, content] = parent
    return [tag, { ...attrs, id: HTMLAttributes.id }, content]
  },
})
