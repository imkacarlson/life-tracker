// Article extraction: URL -> clean markdown.
//
//   fetch with a browser User-Agent
//     -> linkedom parseHTML -> Defuddle(document, url, { markdown: true })
//     -> if the result is thin: retry in headless Chrome for JS-rendered pages
//
// defuddle is the extractor behind Obsidian Web Clipper. It takes a linkedom
// Document and emits markdown directly, replacing both Readability and Turndown.
//
// Heavy modules are imported lazily, matching render-preview.js: a load failure
// then surfaces as a catchable error with detail instead of an opaque
// FUNCTION_INVOCATION_FAILED at cold start.

import { canonicalizeUrl } from './canonicalUrl.js'

// A real desktop UA. Plenty of sites serve a stub or a challenge page to
// anything that announces itself as a bot, and a stub stored as though it were
// the article is exactly the failure this module exists to avoid.
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const FETCH_TIMEOUT_MS = 15_000
// Below this, whatever came back is a teaser, a paywall, or a cookie wall — not
// the article.
const THIN_WORD_COUNT = 150
// Statuses that mean "you are not allowed to read this", as opposed to "this
// broke". The distinction is what the bot tells the user.
const BLOCKED_STATUSES = new Set([401, 402, 403, 405, 406, 429, 451])

async function fetchHtml(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const resp = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })
    return { resp, html: resp.ok ? await resp.text() : '' }
  } finally {
    clearTimeout(timer)
  }
}

async function extractFrom(html, url) {
  const { parseHTML } = await import('linkedom')
  const { Defuddle } = await import('defuddle/node')
  const { document } = parseHTML(html)
  // useAsync would let extractors call third-party APIs from inside the
  // extraction step. Off: this function's whole job is to fetch exactly what it
  // was asked to fetch.
  return await Defuddle(document, url, { markdown: true, useAsync: false })
}

/** Second attempt for pages that render their body in JavaScript. */
async function fetchRenderedHtml(url) {
  const puppeteer = (await import('puppeteer-core')).default
  const chromium = (await import('@sparticuz/chromium')).default

  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
    defaultViewport: { width: 1280, height: 1600 },
  })
  try {
    const page = await browser.newPage()
    await page.setUserAgent(BROWSER_UA)
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 25_000 })
    return await page.content()
  } finally {
    await browser.close()
  }
}

/**
 * Fetch and extract one article.
 *
 * Returns the same envelope as resolvePodcast, so the caller never branches on
 * source type. `status` is 'ok' | 'thin' | 'blocked' | 'error' — and anything
 * but 'ok' means the bot says so out loud. Silently storing a paywall teaser or
 * a login page as if it were the article is the failure mode to design against.
 */
export async function extractArticle(url, { allowBrowserFallback = true } = {}) {
  const base = { sourceType: 'article', url, canonicalUrl: canonicalizeUrl(url) }

  let resp
  let html
  try {
    ;({ resp, html } = await fetchHtml(url))
  } catch (err) {
    const aborted = err?.name === 'AbortError'
    return {
      ...base,
      status: 'error',
      error: aborted ? 'The page took too long to respond.' : `Could not reach the page (${err?.message ?? err}).`,
    }
  }

  if (!resp.ok) {
    return {
      ...base,
      status: BLOCKED_STATUSES.has(resp.status) ? 'blocked' : 'error',
      error: `The site returned ${resp.status}.`,
      meta: { httpStatus: resp.status },
    }
  }

  let result
  try {
    result = await extractFrom(html, url)
  } catch (err) {
    return { ...base, status: 'error', error: `Could not parse the page (${err?.message ?? err}).` }
  }

  // Thin result -> the body is probably rendered client-side. Chrome is already
  // installed and paid for here (render-preview.js uses it), so try once more.
  if (allowBrowserFallback && (result.wordCount ?? 0) < THIN_WORD_COUNT) {
    try {
      const rendered = await fetchRenderedHtml(url)
      const second = await extractFrom(rendered, url)
      if ((second.wordCount ?? 0) > (result.wordCount ?? 0)) result = second
    } catch (err) {
      // Non-fatal: fall through and report whatever the plain fetch produced.
      console.error('fetch-source: browser fallback failed:', String(err?.message ?? err))
    }
  }

  const wordCount = result.wordCount ?? 0
  return {
    ...base,
    status: wordCount >= THIN_WORD_COUNT ? 'ok' : 'thin',
    title: result.title || null,
    markdown: result.content || '',
    meta: {
      author: result.author || null,
      site: result.site || null,
      published: result.published || null,
      description: result.description || null,
      domain: result.domain || null,
      wordCount,
    },
    ...(wordCount >= THIN_WORD_COUNT
      ? {}
      : { error: 'Only got a stub back — this looks like a paywall or a login page.' }),
  }
}
