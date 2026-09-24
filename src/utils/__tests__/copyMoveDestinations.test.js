import { describe, expect, it } from 'vitest'
import { getDestinationNotebooks } from '../copyMoveDestinations'

const notebooks = [
  { id: 'main', title: 'Main' },
  { id: 'archive', title: 'Archive' },
  { id: 'library', title: 'Library' },
]

describe('getDestinationNotebooks', () => {
  it('excludes the notebook the section is in when moving', () => {
    const section = { id: 'sec-july', notebook_id: 'main' }
    expect(getDestinationNotebooks(notebooks, 'move', section).map((nb) => nb.id)).toEqual([
      'archive',
      'library',
    ])
  })

  it('keeps the open notebook when the section lives elsewhere', () => {
    // After moving a section into Archive the app navigates there; the next
    // section (still in Main) must still be movable into Archive.
    const section = { id: 'sec-june', notebook_id: 'main' }
    expect(getDestinationNotebooks(notebooks, 'move', section).map((nb) => nb.id)).toContain(
      'archive',
    )
  })

  it('offers every notebook when copying', () => {
    const section = { id: 'sec-july', notebook_id: 'main' }
    expect(getDestinationNotebooks(notebooks, 'copy', section)).toEqual(notebooks)
  })
})
