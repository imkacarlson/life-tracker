import { describe, expect, it } from 'vitest'
import { toClientPage } from '../pageModel'

describe('toClientPage', () => {
  it('maps the persisted tracker flag to the daily-source name', () => {
    expect(toClientPage({ id: 'page-1', is_tracker_page: true })).toEqual({
      id: 'page-1',
      isDailySource: true,
    })
  })

  it('does not expose the database column to application code', () => {
    const page = toClientPage({ id: 'page-1', is_tracker_page: false })

    expect(page).not.toHaveProperty('is_tracker_page')
    expect(page.isDailySource).toBe(false)
  })

  it('preserves an existing client-side value', () => {
    expect(toClientPage({ id: 'page-1', isDailySource: true }).isDailySource).toBe(true)
  })

  it('passes through a missing page', () => {
    expect(toClientPage(null)).toBeNull()
  })
})
