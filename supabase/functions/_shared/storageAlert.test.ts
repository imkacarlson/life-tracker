import { describe, expect, it } from 'vitest'

import { dailyGrowth, decideStorageAlert, formatBytes, weeksUntilFull } from './storageAlert.ts'

describe('decideStorageAlert', () => {
  it('stays quiet under the first level', () => {
    expect(decideStorageAlert(49.9, [])).toEqual({ alertAt: null, rearm: [] })
  })

  it('alerts at the highest level crossed, once', () => {
    expect(decideStorageAlert(72, []).alertAt).toBe(70)
    expect(decideStorageAlert(72, [50, 70]).alertAt).toBeNull()
  })

  it('skips straight to the highest level after a big jump', () => {
    expect(decideStorageAlert(96, [50]).alertAt).toBe(95)
  })

  it('re-arms levels usage has dropped back under', () => {
    expect(decideStorageAlert(60, [50, 70, 85])).toEqual({ alertAt: null, rearm: [70, 85] })
  })
})

describe('dailyGrowth', () => {
  it('needs two samples on different days', () => {
    expect(dailyGrowth([{ sampled_on: '2026-11-01', db_bytes: 10, storage_bytes: 0 }], 'db_bytes')).toBeNull()
  })

  it('averages growth across the sampled span', () => {
    const samples = [
      { sampled_on: '2026-11-11', db_bytes: 1_000, storage_bytes: 0 },
      { sampled_on: '2026-11-01', db_bytes: 0, storage_bytes: 0 },
    ]
    expect(dailyGrowth(samples, 'db_bytes')).toBe(100)
  })
})

describe('weeksUntilFull', () => {
  it('is null when usage is flat or shrinking', () => {
    expect(weeksUntilFull(10, 100, 0)).toBeNull()
    expect(weeksUntilFull(10, 100, -5)).toBeNull()
    expect(weeksUntilFull(10, 100, null)).toBeNull()
  })

  it('divides the remaining room by weekly growth', () => {
    expect(weeksUntilFull(30, 100, 10)).toBe(1)
  })
})

describe('formatBytes', () => {
  it('shows MB below a gigabyte and GB above', () => {
    expect(formatBytes(104 * 1024 ** 2)).toBe('104 MB')
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.50 GB')
  })
})
