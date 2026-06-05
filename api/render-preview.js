// Vercel serverless function: render a tracker page (or a proposed edit) to a
// PNG preview. Called server-to-server by the Telegram bot edge function, which
// authenticates with a shared secret. Runs on Node 22 (see package.json engines)
// because @sparticuz/chromium requires it.
//
// Heavy modules (chromium, puppeteer, linkedom, tiptap) are imported lazily
// inside renderPage so a load failure surfaces as a catchable error with detail,
// instead of an opaque FUNCTION_INVOCATION_FAILED at cold start.

import { collectStoragePaths, applySignedUrls } from './_lib/hydrateImages.js'

const IMAGE_BUCKET = 'tracker-images'
const SIGNED_URL_TTL = 3600

/** Read a page by id, sign its images, and render it to a PNG buffer. */
async function renderPage(pageId, blockId) {
  const { createClient } = await import('@supabase/supabase-js')
  const { renderTrackerPng } = await import('./_lib/renderTracker.js')

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )

  const { data: page, error } = await supabase
    .from('pages')
    .select('content, title')
    .eq('id', pageId)
    .single()
  if (error || !page) {
    const err = new Error('Page not found')
    err.code = 'NOT_FOUND'
    throw err
  }

  const paths = new Set()
  collectStoragePaths(page.content, paths)
  const signedMap = {}
  for (const storagePath of paths) {
    const { data: signed } = await supabase.storage
      .from(IMAGE_BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL)
    if (signed?.signedUrl) signedMap[storagePath] = signed.signedUrl
  }
  const hydrated = applySignedUrls(page.content, signedMap)

  return await renderTrackerPng({ content: hydrated, blockId })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const provided = req.headers['x-render-secret']
  const expected = process.env.RENDER_SHARED_SECRET
  if (!expected || provided !== expected) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {}
    const { pageId, blockId } = body
    if (!pageId) {
      res.status(400).json({ error: 'pageId is required' })
      return
    }

    const png = await renderPage(pageId, blockId)
    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).send(png)
  } catch (err) {
    if (err?.code === 'NOT_FOUND') {
      res.status(404).json({ error: 'Page not found' })
      return
    }
    console.error('render-preview error:', err)
    res.status(500).json({ error: 'Render failed', detail: String(err?.stack || err).slice(0, 1200) })
  }
}
