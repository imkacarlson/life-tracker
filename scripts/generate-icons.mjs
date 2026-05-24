// Rasterizes the brand logo into the PNG icons the PWA manifest needs.
// Run with: node scripts/generate-icons.mjs
// Source of truth for the mark is DESIGN.md (#0D9488 teal square + white trend arrow).
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = join(root, 'public')

// "any" purpose: the brand logo as-is (rounded teal square).
const anyLogo = `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="48" height="48" rx="10" fill="#0D9488"/>
  <path d="M12 28L20 20L26 26L36 16" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M30 16H36V22" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`

// "maskable" purpose: full-bleed teal (no rounded corners) so the OS mask can
// clip to any shape without exposing transparent corners. The arrow already
// sits within the central safe zone (~25%-75% of the canvas).
const maskableLogo = `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="48" height="48" fill="#0D9488"/>
  <path d="M12 28L20 20L26 26L36 16" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M30 16H36V22" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`

const targets = [
  { svg: anyLogo, size: 192, out: 'pwa-192x192.png' },
  { svg: anyLogo, size: 512, out: 'pwa-512x512.png' },
  { svg: maskableLogo, size: 512, out: 'pwa-maskable-512x512.png' },
  { svg: anyLogo, size: 180, out: 'apple-touch-icon.png' },
]

for (const { svg, size, out } of targets) {
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(join(publicDir, out))
  console.log(`wrote public/${out} (${size}x${size})`)
}
