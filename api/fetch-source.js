// Vercel serverless function: turn something the user shared into a Library
// capture's raw material. Sibling to render-preview.js — same Node 22 runtime,
// same lazy heavy imports, same shared-secret gate (its own header).
//
// It runs here rather than as a Supabase edge function because defuddle and
// linkedom are Node-shaped, and because the headless-Chrome fallback for
// JavaScript-rendered pages is already installed and paid for on this runtime.
//
// It ALWAYS returns 200 with a status field rather than an HTTP error for an
// unreadable source: "I couldn't read this one" is a normal outcome the bot
// reports to the user, not a failure of this endpoint.

import { canonicalizeUrl } from './_lib/canonicalUrl.js'
import { urlsInText } from './_lib/podcastFeed.js'

const MAX_TEXT_CHARS = 20_000

function json(res, body, status = 200) {
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.status(status).json(body)
}

/**
 * Decide what kind of thing this is.
 *
 * `hint` from the caller wins — the bot may already know (e.g. the user said
 * "this podcast"). Otherwise a known podcast host routes to the feed path, any
 * other URL to the article path, and no URL at all is just a note.
 */
async function classify(text, hint) {
  const urls = urlsInText(text)
  if (hint === 'podcast') return 'podcast'
  if (hint === 'article' && urls.length) return 'article'
  if (!urls.length) return 'note'
  const { looksLikePodcast } = await import('./_lib/podcastResolve.js')
  return looksLikePodcast(text) ? 'podcast' : 'article'
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    json(res, { error: 'Method not allowed' }, 405)
    return
  }

  const provided = req.headers['x-fetch-secret']
  const expected = process.env.FETCH_SHARED_SECRET
  // Fail closed on a missing secret, BEFORE any comparison.
  if (!expected) {
    console.error('FETCH_SHARED_SECRET not configured')
    json(res, { error: 'Server misconfigured' }, 500)
    return
  }
  if (provided !== expected) {
    json(res, { error: 'Unauthorized' }, 401)
    return
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
    const text = String(body.text ?? '').slice(0, MAX_TEXT_CHARS)
    const hint = body.sourceType

    if (!text.trim()) {
      json(res, { error: 'text is required' }, 400)
      return
    }

    const kind = await classify(text, hint)

    if (kind === 'note') {
      // Nothing to fetch. 'none' is a legitimate outcome, not an error: a
      // thought with no link is a perfectly good capture.
      json(res, {
        status: 'none',
        sourceType: 'note',
        url: null,
        canonicalUrl: null,
        title: null,
        markdown: '',
        meta: {},
      })
      return
    }

    if (kind === 'podcast') {
      const { resolvePodcast } = await import('./_lib/podcastResolve.js')
      const result = await resolvePodcast(text)
      json(res, {
        url: urlsInText(text)[0] ?? null,
        canonicalUrl: null,
        title: null,
        markdown: '',
        meta: {},
        ...result,
      })
      return
    }

    const url = urlsInText(text)[0]
    const { extractArticle } = await import('./_lib/articleExtract.js')
    const result = await extractArticle(url)
    json(res, { canonicalUrl: canonicalizeUrl(url), title: null, markdown: '', meta: {}, ...result })
  } catch (err) {
    console.error('fetch-source error:', err)
    json(
      res,
      { status: 'error', error: 'Extraction failed', detail: String(err?.stack || err).slice(0, 1200) },
      500,
    )
  }
}
