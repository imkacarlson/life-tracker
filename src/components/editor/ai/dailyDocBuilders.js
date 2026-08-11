import { buildHash } from '../../../utils/navigationHelpers'
import { getMergeableTemplateList } from '../templateHelpers'

const makePlaceholderListItem = () => ({
  type: 'listItem',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: '...' }],
    },
  ],
})

export const buildDailyListItems = (
  tasks,
  { notebookId, sectionId, sourcePageId },
) =>
  tasks.map((task) => {
    const content = [{ type: 'text', text: task.task }]
    if (task.block_ids?.length) {
      task.block_ids.forEach((blockId, index) => {
        const href = buildHash({
          notebookId,
          sectionId,
          pageId: sourcePageId,
          blockId,
        })
        content.push({ type: 'text', text: ' ' })
        content.push({
          type: 'text',
          text: `[${index + 1}]`,
          marks: [{ type: 'link', attrs: { href, target: '_self' } }],
        })
      })
    }
    return { type: 'listItem', content: [{ type: 'paragraph', content }] }
  })

export const buildDailyRow = ({
  label,
  tasks,
  extraNodes = [],
  linkContext,
}) => {
  const items = buildDailyListItems(tasks, linkContext)
  const content = [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: label, marks: [{ type: 'bold' }] }],
    },
  ]

  if (extraNodes.length) {
    const mergeInfo = getMergeableTemplateList(extraNodes)
    if (mergeInfo) {
      const mergedList = {
        ...mergeInfo.listNode,
        content: [...(mergeInfo.listNode.content || []), ...items],
      }
      content.push(...mergeInfo.prefix, mergedList)
      return {
        type: 'tableRow',
        content: [{ type: 'tableCell', content }],
      }
    }
    content.push(...extraNodes)
  }

  content.push({
    type: 'bulletList',
    content: items.length ? items : [makePlaceholderListItem()],
  })
  return {
    type: 'tableRow',
    content: [{ type: 'tableCell', content }],
  }
}

export const buildDailyInsertContent = ({
  selectedDate,
  asapTasks,
  fyiTasks,
  templateNodes,
  warning,
  notebookId,
  sectionId,
  sourcePageId,
}) => {
  const linkContext = { notebookId, sectionId, sourcePageId }
  const heading = {
    type: 'heading',
    attrs: { level: 2 },
    content: [
      {
        type: 'text',
        text: selectedDate.toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        }),
      },
    ],
  }
  const table = {
    type: 'table',
    content: [
      buildDailyRow({ label: 'ASAP', tasks: asapTasks, extraNodes: templateNodes, linkContext }),
      buildDailyRow({ label: 'FYI', tasks: fyiTasks, linkContext }),
    ],
  }

  const content = [heading]
  if (warning) {
    content.push({
      type: 'paragraph',
      content: [{ type: 'text', text: warning, marks: [{ type: 'italic' }] }],
    })
  }
  content.push(table)
  return content
}
