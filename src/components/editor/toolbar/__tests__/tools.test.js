import { describe, it, expect } from 'vitest'
import { TOOL_DEFINITIONS, CORE_GROUPS, EXTRA_GROUPS } from '../tools'

describe('toolbar tool registry', () => {
  const allGroupToolIds = [...CORE_GROUPS, ...EXTRA_GROUPS]
    .filter((g) => !g.separator)
    .flatMap((g) => g.tools)

  it('every referenced tool ID resolves to a registered Component', () => {
    for (const id of allGroupToolIds) {
      expect(TOOL_DEFINITIONS[id], `missing tool definition for "${id}"`).toBeDefined()
      expect(typeof TOOL_DEFINITIONS[id].Component).toBe('function')
    }
  })

  it('group IDs are unique', () => {
    const ids = [...CORE_GROUPS, ...EXTRA_GROUPS].map((g) => g.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('mobileOnly tools only appear in groups that exist on mobile (CORE)', () => {
    const mobileOnlyIds = Object.entries(TOOL_DEFINITIONS)
      .filter(([, def]) => def.mobileOnly)
      .map(([id]) => id)
    const extraIds = EXTRA_GROUPS.filter((g) => !g.separator).flatMap((g) => g.tools)
    for (const id of mobileOnlyIds) {
      expect(extraIds, `${id} should be in CORE, not EXTRA`).not.toContain(id)
    }
  })

  it('separator entries are well-formed', () => {
    const separators = EXTRA_GROUPS.filter((g) => g.separator)
    for (const sep of separators) {
      expect(sep.id).toBeTruthy()
      expect(sep.tools).toBeUndefined()
    }
  })
})
