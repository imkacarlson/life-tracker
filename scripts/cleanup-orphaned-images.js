#!/usr/bin/env node

// One-time manual cleanup script for orphaned images in Supabase Storage.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/cleanup-orphaned-images.js          # dry-run
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/cleanup-orphaned-images.js --delete  # actually delete
//
// Requires the service role key (not the anon key) because listing all files
// in a storage bucket requires admin-level access. Get it from:
// Supabase Dashboard → Settings → API → service_role key

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.resolve(__dirname, '..', '.env.local') })
config({ path: path.resolve(__dirname, '..', '.env.test'), override: true })

const BUCKET = 'tracker-images'
const shouldDelete = process.argv.includes('--delete')

const supabaseUrl = process.env.VITE_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// Recursively walk Tiptap JSON to collect all image storagePath values.
const collectStoragePaths = (node, paths) => {
  if (!node) return
  if (node.type === 'image' && node.attrs?.storagePath) {
    paths.add(node.attrs.storagePath)
  }
  if (Array.isArray(node.content)) {
    node.content.forEach((child) => collectStoragePaths(child, paths))
  }
}

const run = async () => {
  console.log(`\n=== Orphaned Image Cleanup (${shouldDelete ? 'DELETE' : 'DRY RUN'}) ===\n`)

  // 1. List all files in storage bucket
  const { data: folders, error: folderError } = await supabase.storage.from(BUCKET).list('', {
    limit: 1000,
  })
  if (folderError) {
    console.error('Failed to list bucket root:', folderError.message)
    process.exit(1)
  }

  const allStorageFiles = new Set()
  for (const folder of folders) {
    if (!folder.id) {
      // This is a folder (user ID prefix), list its contents
      const { data: files, error } = await supabase.storage.from(BUCKET).list(folder.name, {
        limit: 10000,
      })
      if (error) {
        console.error(`Failed to list folder ${folder.name}:`, error.message)
        continue
      }
      for (const file of files ?? []) {
        allStorageFiles.add(`${folder.name}/${file.name}`)
      }
    }
  }

  console.log(`Storage files found: ${allStorageFiles.size}`)

  // 2. Load all pages (paginated) and settings, collect all referenced image paths
  const referencedPaths = new Set()
  const BATCH_SIZE = 1000
  let pageOffset = 0
  let totalPages = 0
  while (true) {
    const { data, error } = await supabase
      .from('pages')
      .select('id, content')
      .order('id')
      .range(pageOffset, pageOffset + BATCH_SIZE - 1)
    if (error) {
      console.error('Failed to load pages:', error.message)
      process.exit(1)
    }
    for (const page of data ?? []) {
      try {
        collectStoragePaths(page.content, referencedPaths)
      } catch {
        console.warn(`Skipping page ${page.id} — malformed content`)
      }
    }
    totalPages += (data ?? []).length
    if (!data || data.length < BATCH_SIZE) break
    pageOffset += BATCH_SIZE
  }

  const { data: settings, error: settingsError } = await supabase
    .from('settings')
    .select('id, daily_template_content')

  if (settingsError) {
    console.error('Failed to load settings:', settingsError.message)
    process.exit(1)
  }

  for (const row of settings ?? []) {
    try {
      collectStoragePaths(row.daily_template_content, referencedPaths)
    } catch {
      console.warn(`Skipping settings ${row.id} — malformed daily template content`)
    }
  }

  console.log(`Referenced image paths: ${referencedPaths.size} (from ${totalPages} pages + ${(settings ?? []).length} settings rows)`)

  // 3. Find orphans
  const orphans = [...allStorageFiles].filter((p) => !referencedPaths.has(p))
  console.log(`Orphaned files: ${orphans.length}`)

  if (orphans.length === 0) {
    console.log('\nNo orphans found. Storage is clean.')
    return
  }

  console.log('\nOrphaned files:')
  for (const orphan of orphans) {
    console.log(`  ${orphan}`)
  }

  // 4. Delete if flag is set
  if (shouldDelete) {
    const { error: deleteError } = await supabase.storage.from(BUCKET).remove(orphans)
    if (deleteError) {
      console.error('\nDelete failed:', deleteError.message)
      process.exit(1)
    }
    console.log(`\nDeleted ${orphans.length} orphaned file(s).`)
  } else {
    console.log('\nDry run — no files deleted. Run with --delete to remove.')
  }
}

run().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
