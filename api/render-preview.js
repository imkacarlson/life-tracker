// Vercel serverless function: render a tracker page (or a proposed edit) to a
// PNG preview. Called server-to-server by the Telegram bot edge function, which
// authenticates with a shared secret. Runs on Node 22 (see package.json engines)
// because @sparticuz/chromium requires it.
//
// Heavy modules (chromium, puppeteer, jsdom, tiptap) are imported lazily inside
// the handler so a load failure surfaces as a catchable error with detail,
// instead of an opaque FUNCTION_INVOCATION_FAILED at cold start.

import { collectStoragePaths, applySignedUrls } from './_lib/hydrateImages.js'

const IMAGE_BUCKET = 'tracker-images'
const SIGNED_URL_TTL = 3600

export default async function handler(req, res) {
  // TEMPORARY diagnostic (no auth): GET ?diag=1 reports which heavy modules load.
  // Remove once the deploy is healthy.
  if (req.method === 'GET' && req.query?.diag) {
    const mods = [
      'jsdom',
      '@tiptap/core',
      'puppeteer-core',
      '@sparticuz/chromium',
      '@supabase/supabase-js',
      './_lib/renderExtensions.js',
      './_lib/renderTracker.js',
    ]
    const results = {}
    for (const m of mods) {
      try {
        await import(m)
        results[m] = 'ok'
      } catch (e) {
        results[m] = String(e?.message || e)
      }
    }
    res.status(200).json({ node: process.version, results })
    return
  }

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
      res.status(404).json({ error: 'Page not found' })
      return
    }

    // Hydrate images: sign each storage path so Chrome can load them.
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

    const png = await renderTrackerPng({ content: hydrated, blockId })

    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).send(png)
  } catch (err) {
    console.error('render-preview error:', err)
    res.status(500).json({ error: 'Render failed', detail: String(err?.stack || err).slice(0, 1200) })
  }
}
