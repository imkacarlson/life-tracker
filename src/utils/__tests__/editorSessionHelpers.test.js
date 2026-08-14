import { describe, it, expect } from 'vitest'
import {
  computeSessionKey,
  computeSessionMode,
  computeSessionStatusSync,
} from '../editorSessionHelpers'

const PAGE_ID = 'abc-123'
const PAGE_ID_2 = 'def-456'
const PAGE = { id: PAGE_ID, title: 'Test Page', content: { type: 'doc', content: [] } }

describe('computeSessionMode', () => {
  it('returns "template" when settingsMode is daily-template', () => {
    expect(computeSessionMode('daily-template', PAGE_ID)).toBe('template')
  })

  it('returns "settings" when settingsMode is a non-template settings mode', () => {
    expect(computeSessionMode('something', PAGE_ID)).toBe('settings')
    expect(computeSessionMode('other-settings', null)).toBe('settings')
  })

  it('returns "page" when no settingsMode and activePageId is set', () => {
    expect(computeSessionMode(null, PAGE_ID)).toBe('page')
    expect(computeSessionMode(undefined, PAGE_ID)).toBe('page')
    expect(computeSessionMode(false, PAGE_ID)).toBe('page')
    expect(computeSessionMode('', PAGE_ID)).toBe('page')
  })

  it('returns "idle" when no settingsMode and no activePageId', () => {
    expect(computeSessionMode(null, null)).toBe('idle')
    expect(computeSessionMode(undefined, undefined)).toBe('idle')
    expect(computeSessionMode(false, null)).toBe('idle')
  })
})

describe('computeSessionStatusSync', () => {
  it('returns "idle" when mode is "idle"', () => {
    expect(computeSessionStatusSync('idle', null, false)).toBe('idle')
  })

  it('returns "idle" when mode is "settings"', () => {
    expect(computeSessionStatusSync('settings', null, false)).toBe('idle')
  })

  it('returns "loading" when mode is "page" and activePage is null', () => {
    expect(computeSessionStatusSync('page', null, false)).toBe('loading')
  })

  it('returns "loading" when mode is "page" and activePage is null but dataLoading is true', () => {
    expect(computeSessionStatusSync('page', null, true)).toBe('loading')
  })

  it('returns "pending-hydration" when mode is "page" and activePage is available', () => {
    expect(computeSessionStatusSync('page', PAGE, false)).toBe('pending-hydration')
  })

  it('returns "loading" when mode is "page" and activePage exists but content is undefined (cache not loaded)', () => {
    const pageMetaOnly = { id: PAGE_ID, title: 'Test Page', content: undefined }
    expect(computeSessionStatusSync('page', pageMetaOnly, false)).toBe('loading')
  })

  it('returns "pending-hydration" when mode is "template"', () => {
    // Template content is always available (via ref); we always need to hydrate
    expect(computeSessionStatusSync('template', null, false)).toBe('pending-hydration')
  })
})

describe('computeSessionKey', () => {
  it('returns "idle" for idle mode', () => {
    expect(computeSessionKey('idle', null, 0, null, null)).toBe('idle')
  })

  it('returns "settings" for settings mode', () => {
    expect(computeSessionKey('settings', null, 0, null, null)).toBe('settings')
  })

  it('returns "loading:<pageId>" while page content is loading (null activePage)', () => {
    expect(computeSessionKey('page', PAGE_ID, 0, null, null)).toBe(`loading:${PAGE_ID}`)
  })

  it('returns "loading:<pageId>" when activePage exists but content is undefined (cache not loaded)', () => {
    const pageMetaOnly = { id: PAGE_ID, title: 'Test Page', content: undefined }
    expect(computeSessionKey('page', PAGE_ID, 0, pageMetaOnly, null)).toBe(`loading:${PAGE_ID}`)
  })

  it('includes pageId and nonce for page mode', () => {
    expect(computeSessionKey('page', PAGE_ID, 0, PAGE, null)).toBe(`${PAGE_ID}:0`)
    expect(computeSessionKey('page', PAGE_ID, 3, PAGE, null)).toBe(`${PAGE_ID}:3`)
  })

  it('changes when pageId changes', () => {
    const key1 = computeSessionKey('page', PAGE_ID, 0, PAGE, null)
    const key2 = computeSessionKey('page', PAGE_ID_2, 0, { ...PAGE, id: PAGE_ID_2 }, null)
    expect(key1).not.toBe(key2)
  })

  it('changes when nonce is bumped (same pageId)', () => {
    const key1 = computeSessionKey('page', PAGE_ID, 0, PAGE, null)
    const key2 = computeSessionKey('page', PAGE_ID, 1, PAGE, null)
    expect(key1).not.toBe(key2)
  })

  it('includes settingsContentVersion for template mode', () => {
    expect(computeSessionKey('template', null, 0, null, 7)).toBe('template:7')
    expect(computeSessionKey('template', null, 0, null, 12)).toBe('template:12')
  })

  it('template key changes when settingsContentVersion changes', () => {
    const key1 = computeSessionKey('template', null, 0, null, 1)
    const key2 = computeSessionKey('template', null, 0, null, 2)
    expect(key1).not.toBe(key2)
  })
})
