// Client for the Vercel source-extraction function (api/fetch-source.js).
// Sibling of render.ts, and the same shape: this module owns the Deno.env reads
// and the network call, so library.ts and tools.ts stay importable by Vitest.
//
// The bot calls it server-to-server with a shared secret and gets back a single
// envelope: { status, sourceType, url, canonicalUrl, title, markdown, meta }.

import type { FetchedSource } from './library.ts'

const FETCH_ENDPOINT_URL = Deno.env.get('FETCH_SOURCE_URL') ?? ''
const FETCH_SHARED_SECRET = Deno.env.get('FETCH_SHARED_SECRET') ?? ''

const EMPTY: FetchedSource = {
  status: 'none',
  sourceType: 'note',
  url: null,
  canonicalUrl: null,
  title: null,
  markdown: '',
  meta: {},
}

/**
 * Read whatever the user shared.
 *
 * Never throws. An unreadable source is a normal outcome the bot reports to the
 * user ("couldn't read this one, saved the link and your note"), so a failure
 * here degrades to a note rather than losing the capture.
 */
export async function fetchSourceFromShare(text: string): Promise<FetchedSource> {
  if (!FETCH_ENDPOINT_URL) {
    return { ...EMPTY, status: 'error', error: 'Source fetching is not configured.' }
  }
  try {
    const resp = await fetch(FETCH_ENDPOINT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-fetch-secret': FETCH_SHARED_SECRET },
      body: JSON.stringify({ text }),
    })
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '')
      console.error(`fetchSource failed (${resp.status})`, detail.slice(0, 300))
      return { ...EMPTY, status: 'error', error: 'Could not reach the extractor.' }
    }
    return { ...EMPTY, ...(await resp.json()) } as FetchedSource
  } catch (err) {
    console.error('fetchSource error:', String(err))
    return { ...EMPTY, status: 'error', error: 'Could not reach the extractor.' }
  }
}
