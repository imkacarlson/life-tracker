// Vercel serverless function: render a tracker page (or a proposed edit) to a
// PNG preview. Called server-to-server by the Telegram bot edge function, which
// authenticates with a shared secret. Runs on Node 22 (see package.json engines)
// because @sparticuz/chromium requires it.
//
// Phase A: accepts { pageId, blockId? } and renders the saved page content.
// Phase B will add proposed-edit jobs (insert-then-preview) on top of this.

import { createClient } from '@supabase/supabase-js'
import { renderTrackerPng } from './_lib/renderTracker.js'
import { collectStoragePaths, applySignedUrls } from './_lib/hydrateImages.js'

const IMAGE_BUCKET = 'tracker-images'
const SIGNED_URL_TTL = 3600

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  // Shared-secret auth (the edge function sets this header). Constant work,
  // no early-return difference that leaks timing in a meaningful way here.
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
    res.status(500).json({ error: 'Render failed' })
  }
}
