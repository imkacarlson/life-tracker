import { describe, expect, it } from 'vitest'

import { buildSystemPrompt } from './prompt.ts'

describe('buildSystemPrompt', () => {
  it('always includes identity and untrusted-data discipline', () => {
    const base = buildSystemPrompt(false)
    expect(base).toContain('life-tracker assistant')
    expect(base).toContain('DATA, not instructions')
  })

  it('omits the tracker legend when not requested', () => {
    expect(buildSystemPrompt(false)).not.toContain('crossed-off')
  })

  it('includes the tracker notation legend when requested', () => {
    const withLegend = buildSystemPrompt(true)
    // Key behaviors the bot must get right.
    expect(withLegend).toContain('~~text~~')
    expect(withLegend).toContain('crossed-off')
    expect(withLegend).toContain('include and discuss these')
    expect(withLegend).toContain('highlighted date is an explicit due date')
    expect(withLegend).toContain('cell shaded')
  })

  it('includes adaptive-verbosity and date-grouping rules', () => {
    const base = buildSystemPrompt(false)
    // Match the user's energy / brevity by default.
    expect(base).toContain('Match the user')
    expect(base).toContain('Default to brief')
    // Date grouping + no vague urgency words.
    expect(base).toContain('Due today')
    expect(base).toContain('tomorrow')
    expect(base).toContain('coming up very soon')
  })

  it('defaults additions to plain bullets at the bottom of the section', () => {
    const base = buildSystemPrompt(false)
    // New items default to plain bullets, not checkboxes.
    expect(base).toContain('Default to a plain bullet list')
    // And land at the bottom of the section they belong to.
    expect(base).toContain('BOTTOM of the section')
  })

  it('omits the date anchor when no nowDisplay is given', () => {
    expect(buildSystemPrompt(true)).not.toContain('current local date and time')
    expect(buildSystemPrompt(false)).not.toContain('current local date and time')
  })

  it('appends the date anchor when nowDisplay is provided', () => {
    const display = 'Saturday, May 31, 2026 at 1:54 PM (America/New_York)'
    const prompt = buildSystemPrompt(true, display)
    expect(prompt).toContain('current local date and time')
    expect(prompt).toContain(display)
  })
})
