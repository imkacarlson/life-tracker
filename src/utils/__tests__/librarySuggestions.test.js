import { describe, expect, it } from 'vitest'
import {
  MAX_SUGGESTION_SLOTS,
  buildNewTopicDoc,
  buildSuggestionSlots,
  toClientSuggestion,
} from '../librarySuggestions'

const suggestion = (title) => ({ id: title, title, why: 'noticed', evidencePageIds: [] })

describe('buildSuggestionSlots', () => {
  it('shows what was noticed, then one door to make your own', () => {
    const slots = buildSuggestionSlots([suggestion('Bouncing back'), suggestion('Marathon debuts')])
    expect(slots.map((slot) => slot.kind)).toEqual(['suggestion', 'suggestion', 'placeholder'])
  })

  it('never empties — nothing noticed is still one card, not a blank space', () => {
    // A Library with two captures in it has to read as usable rather than
    // broken, and this card is the designed answer to that.
    const slots = buildSuggestionSlots([])
    expect(slots).toEqual([{ kind: 'placeholder' }])
  })

  it('stops at the cap, so the block never scrolls', () => {
    const many = Array.from({ length: 9 }, (_, i) => suggestion(`T${i}`))
    const slots = buildSuggestionSlots(many)
    expect(slots).toHaveLength(MAX_SUGGESTION_SLOTS)
    // Full means no placeholder: the sidebar footer is the other way in, and a
    // sixth card is where a block turns into a list.
    expect(slots.every((slot) => slot.kind === 'suggestion')).toBe(true)
  })

  it('leaves the door open right up to the last slot', () => {
    const four = Array.from({ length: MAX_SUGGESTION_SLOTS - 1 }, (_, i) => suggestion(`T${i}`))
    expect(buildSuggestionSlots(four).at(-1)).toEqual({ kind: 'placeholder' })
  })

  it('is fine with junk instead of a list', () => {
    expect(buildSuggestionSlots(null)).toEqual([{ kind: 'placeholder' }])
    expect(buildSuggestionSlots(undefined)).toEqual([{ kind: 'placeholder' }])
  })
})

describe('toClientSuggestion', () => {
  it('renames the columns and defaults the empty ones', () => {
    expect(
      toClientSuggestion({
        id: 'sug-1',
        scope: 'topic',
        section_id: 'sec-1',
        title: 'Bouncing back',
        why: '2 saved, both about a rough race',
        evidence_page_ids: ['cap-1'],
      }),
    ).toEqual({
      id: 'sug-1',
      scope: 'topic',
      sectionId: 'sec-1',
      title: 'Bouncing back',
      why: '2 saved, both about a rough race',
      evidencePageIds: ['cap-1'],
    })
  })

  it('carries a Library-wide suggestion with no section', () => {
    expect(toClientSuggestion({ id: 's', scope: 'section', title: 'Health IT' }).sectionId).toBeNull()
  })
})

describe('buildNewTopicDoc', () => {
  it('says the page is app-written and currently empty, not nothing at all', () => {
    const flat = JSON.stringify(buildNewTopicDoc())
    expect(flat).toContain('Nothing filed here yet')
    expect(flat).toContain('rewritten whenever something new is saved')
  })
})
