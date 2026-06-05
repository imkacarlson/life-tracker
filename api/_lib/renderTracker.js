// Core preview renderer: Tiptap JSON -> faithful PNG of the tracker.
//
// Pipeline:
//   1. generateHTML(content) using the app's real schema (renderExtensions).
//      generateHTML relies on a global `document` (ProseMirror's DOMSerializer),
//      which doesn't exist in Node — so we polyfill it with jsdom.
//   2. Wrap that HTML in the app's real editor stylesheet + web fonts so it looks
//      identical to what the user sees in the app.
//   3. Render in headless Chrome (@sparticuz/chromium) and screenshot — either
//      the whole page, or cropped to a highlighted block + its surrounding area.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { generateHTML } from '@tiptap/core'
import puppeteer from 'puppeteer-core'
import chromium from '@sparticuz/chromium'
import { renderExtensions } from './renderExtensions.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../../')

// The editor reading column width in the app (layout.css: max-width 720px).
const CONTENT_WIDTH = 720
const PAGE_PADDING = 24
const VIEWPORT_WIDTH = CONTENT_WIDTH + PAGE_PADDING * 2 // 768
// Vertical context to include above/below a highlighted block when cropping.
const CROP_CONTEXT_PX = 160

// generateHTML uses the global `document`; provide one once via jsdom.
let domReady = false
function ensureDom() {
  if (domReady) return
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  domReady = true
}

// Read the app's actual stylesheets so the preview can't drift from the editor.
// Bundled into the function via vercel.json `includeFiles: src/styles/**`.
let cachedCss = null
function loadEditorCss() {
  if (cachedCss) return cachedCss
  const files = ['base.css', 'editor.css']
  cachedCss = files
    .map((f) => fs.readFileSync(path.join(REPO_ROOT, 'src/styles', f), 'utf8'))
    .join('\n')
  return cachedCss
}

function buildHtmlDocument(contentJson, highlightBlockId) {
  ensureDom()
  const innerHtml = generateHTML(contentJson, renderExtensions)
  const css = loadEditorCss()

  // Reuse the app's deep-link highlight treatment for the targeted block.
  const highlightCss = highlightBlockId
    ? `.editor-shell .ProseMirror [id="${cssEscape(highlightBlockId)}"] {
         background: rgba(250, 204, 21, 0.22);
         outline: 2px solid rgba(245, 158, 11, 0.85);
         outline-offset: 2px;
         border-radius: 8px;
       }`
    : ''

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <link href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,600,700&display=swap" rel="stylesheet" />
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>${css}</style>
  <style>
    html, body { margin: 0; padding: 0; background: var(--bg); }
    .render-root {
      box-sizing: border-box;
      width: ${VIEWPORT_WIDTH}px;
      padding: ${PAGE_PADDING}px;
      background: var(--bg);
    }
    .render-root .editor-shell .ProseMirror { padding: 0; }
    ${highlightCss}
  </style>
</head>
<body>
  <div class="render-root">
    <div class="editor-shell"><div class="ProseMirror">${innerHtml}</div></div>
  </div>
</body>
</html>`
}

// Minimal CSS attribute-selector escaping (block ids are UUIDs, but be safe).
function cssEscape(value) {
  return String(value).replace(/["\\]/g, '\\$&')
}

/**
 * Render tracker content to a PNG.
 * @param {object} params
 * @param {object} params.content  Tiptap JSON doc (images already hydrated with signed URLs).
 * @param {string} [params.blockId] If set, crop to this block + surrounding context.
 * @param {number} [params.deviceScaleFactor] Pixel density (default 2 = retina-crisp).
 * @returns {Promise<Buffer>} PNG bytes.
 */
export async function renderTrackerPng({ content, blockId, deviceScaleFactor = 2 }) {
  const html = buildHtmlDocument(content, blockId)

  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
    defaultViewport: { width: VIEWPORT_WIDTH, height: 1400, deviceScaleFactor },
  })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: VIEWPORT_WIDTH, height: 1400, deviceScaleFactor })
    await page.setContent(html, { waitUntil: 'networkidle0' })
    // Ensure web fonts are painted before we capture.
    await page.evaluate(async () => {
      if (document.fonts?.ready) await document.fonts.ready
    })

    let clip = null
    if (blockId) {
      clip = await page.evaluate(
        (id, contextPx, viewportWidth) => {
          const el = document.getElementById(id)
          if (!el) return null
          const r = el.getBoundingClientRect()
          const top = Math.max(0, r.top - contextPx)
          const bottom = r.bottom + contextPx
          return {
            x: 0,
            y: top,
            width: viewportWidth,
            height: bottom - top,
          }
        },
        blockId,
        CROP_CONTEXT_PX,
        VIEWPORT_WIDTH,
      )
    }

    const png = clip
      ? await page.screenshot({ type: 'png', clip })
      : await page.screenshot({ type: 'png', fullPage: true })
    return Buffer.from(png)
  } finally {
    await browser.close()
  }
}
