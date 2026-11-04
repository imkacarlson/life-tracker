// Pure decision logic for storage-alerts: which warning level (if any) to
// email about, and how long until a resource fills at the current pace.

export const THRESHOLDS = [50, 70, 85, 95] as const

export type Resource = 'database' | 'file_storage'

export type Sample = { sampled_on: string; db_bytes: number; storage_bytes: number }

const MS_PER_DAY = 86_400_000

/** Average bytes added per day between the oldest and newest sample (null if unknown). */
export function dailyGrowth(samples: Sample[], key: 'db_bytes' | 'storage_bytes'): number | null {
  if (samples.length < 2) return null
  const sorted = [...samples].sort((a, b) => a.sampled_on.localeCompare(b.sampled_on))
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const days = (Date.parse(last.sampled_on) - Date.parse(first.sampled_on)) / MS_PER_DAY
  if (days <= 0) return null
  return (Number(last[key]) - Number(first[key])) / days
}

/** Weeks until `used` reaches `limit` at `perDay` growth; null when not growing. */
export function weeksUntilFull(used: number, limit: number, perDay: number | null): number | null {
  if (perDay === null || perDay <= 0) return null
  return Math.max(0, (limit - used) / perDay / 7)
}

/**
 * The highest threshold the usage has crossed that hasn't been emailed yet,
 * and the already-sent thresholds that usage has dropped back under (to
 * re-arm after a cleanup).
 */
export function decideStorageAlert(
  percent: number,
  alreadySent: number[],
): { alertAt: number | null; rearm: number[] } {
  const crossed = THRESHOLDS.filter((level) => percent >= level)
  const highest = crossed.length ? crossed[crossed.length - 1] : null
  const alertAt = highest !== null && !alreadySent.includes(highest) ? highest : null
  const rearm = alreadySent.filter((level) => percent < level)
  return { alertAt, rearm }
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  return `${Math.round(bytes / 1024 ** 2)} MB`
}
