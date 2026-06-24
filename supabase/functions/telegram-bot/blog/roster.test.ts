import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchRosters, parseRoster } from './roster.ts'

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), 'utf-8')

const mensHtml = read('mens-team.html')
const womensHtml = read('womens-team.html')

const findUrl = (athletes: { name: string; url: string }[], name: string) =>
  athletes.find((a) => a.name === name)?.url

// Note: all athlete names below are fictional (the fixtures use made-up rosters,
// not the real GRC teams) — nothing committed here is a real teammate's name.
describe('parseRoster', () => {
  it("parses the men's roster with exact profile slugs", () => {
    const mens = parseRoster(mensHtml)
    expect(findUrl(mens, 'Marcus Holloway')).toBe('https://www.grcrunning.com/marcus-holloway/')
    expect(findUrl(mens, 'Anton Vega')).toBe('https://www.grcrunning.com/anton-vega/')
  })

  it("parses the women's roster", () => {
    const womens = parseRoster(womensHtml)
    expect(findUrl(womens, 'Noelle Vargas')).toBe('https://www.grcrunning.com/noelle-vargas/')
    expect(findUrl(womens, 'Robin Asante')).toBe('https://www.grcrunning.com/robin-asante/')
  })

  it('normalizes an irregular http/no-www URL to canonical https://www', () => {
    const womens = parseRoster(womensHtml)
    expect(findUrl(womens, 'Cleo Marchetti')).toBe('https://www.grcrunning.com/cleo-marchetti/')
  })

  it('decodes HTML entities in names', () => {
    const mens = parseRoster(mensHtml)
    expect(mens.some((a) => a.name === 'Soren O’Vance')).toBe(true)
  })

  it('excludes nav and footer links (no img+figcaption wrapper)', () => {
    const mens = parseRoster(mensHtml)
    const slugs = mens.map((a) => a.url)
    expect(slugs.some((u) => u.includes('/blog/'))).toBe(false)
    expect(slugs.some((u) => u.includes('/coach-jerry/'))).toBe(false)
    expect(slugs.some((u) => u.includes('/in-memoriam/'))).toBe(false)
  })

  it('returns nothing for markup with no athlete figures', () => {
    expect(parseRoster('<nav><a href="https://www.grcrunning.com/blog/">Blog</a></nav>')).toHaveLength(0)
  })
})

describe('fetchRosters', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('fetches and parses both team pages', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true,
      text: async () => (String(url).includes('womens') ? womensHtml : mensHtml),
    })))
    const { mens, womens } = await fetchRosters()
    expect(mens.length).toBeGreaterThanOrEqual(10)
    expect(womens.length).toBeGreaterThanOrEqual(10)
    expect(findUrl(womens, 'Noelle Vargas')).toBe('https://www.grcrunning.com/noelle-vargas/')
  })

  it('throws when a roster parses too small (possible layout change)', async () => {
    const tiny = '<figure><a href="https://www.grcrunning.com/solo-runner/"><img alt=""/></a>' +
      '<figcaption class="wp-element-caption">Solo Runner</figcaption></figure>'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => tiny })))
    await expect(fetchRosters()).rejects.toThrow(/layout may have changed/)
  })

  it('throws on an HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, text: async () => '' })))
    await expect(fetchRosters()).rejects.toThrow(/Failed to fetch/)
  })
})
