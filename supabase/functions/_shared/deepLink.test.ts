import { describe, expect, it } from 'vitest'

import { buildDeepLink } from './deepLink.ts'
// The front-end parser this must satisfy. If these two ever disagree, links
// navigate nowhere with no error anywhere — hence the direct round-trip test.
import { parseDeepLink } from '../../../src/utils/navigationHelpers.js'

const APP = 'https://life-tracker-mu-sandy.vercel.app'

const hashOf = (url: string) => url.slice(url.indexOf('#'))

describe('buildDeepLink', () => {
  it('puts nb first so parseDeepLink accepts the hash', () => {
    const url = buildDeepLink(
      { notebookId: 'nb1', sectionId: 'sec1', pageId: 'pg1', blockId: 'blk1' },
      APP,
    )
    expect(url.startsWith(`${APP}/#nb=`)).toBe(true)
  })

  it('falls back to #sec= then #pg= as parts drop out', () => {
    expect(hashOf(buildDeepLink({ sectionId: 's', pageId: 'p' }, APP)).startsWith('#sec=')).toBe(true)
    expect(hashOf(buildDeepLink({ pageId: 'p', blockId: 'b' }, APP)).startsWith('#pg=')).toBe(true)
  })

  it('returns empty when nothing is resolvable', () => {
    expect(buildDeepLink({}, APP)).toBe('')
    expect(buildDeepLink({ notebookId: null, pageId: null }, APP)).toBe('')
  })

  it('tolerates a trailing slash on APP_URL', () => {
    expect(buildDeepLink({ pageId: 'p' }, `${APP}/`)).toBe(`${APP}/#pg=p`)
  })

  it('returns a bare hash when no app URL is configured', () => {
    expect(buildDeepLink({ pageId: 'p' }, '')).toBe('#pg=p')
  })

  it('round-trips through the front-end parser', () => {
    const parts = { notebookId: 'nb1', sectionId: 'sec1', pageId: 'pg1', blockId: 'blk1' }
    expect(parseDeepLink(hashOf(buildDeepLink(parts, APP)))).toEqual(parts)
  })

  it('round-trips a block-only-under-page link', () => {
    const url = buildDeepLink({ pageId: 'pg1', blockId: 'blk1' }, APP)
    expect(parseDeepLink(hashOf(url))).toEqual({
      notebookId: null,
      sectionId: null,
      pageId: 'pg1',
      blockId: 'blk1',
    })
  })
})
