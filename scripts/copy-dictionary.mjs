// Vendors the Hunspell dictionary from the dictionary-en package into
// public/dictionaries/en so the browser can fetch it at runtime. The package
// itself reads its files via node:fs (Node-only) and blocks subpath imports via
// its exports map, so we copy the raw .aff/.dic out once and serve them as
// static assets. Re-run after bumping dictionary-en:
//   node scripts/copy-dictionary.mjs
import { copyFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, 'node_modules', 'dictionary-en')
const destDir = join(root, 'public', 'dictionaries', 'en')

await mkdir(destDir, { recursive: true })
for (const file of ['index.aff', 'index.dic']) {
  await copyFile(join(srcDir, file), join(destDir, file))
  console.log(`copied ${file} -> public/dictionaries/en/${file}`)
}
