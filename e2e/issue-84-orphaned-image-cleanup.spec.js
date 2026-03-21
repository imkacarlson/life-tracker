import { test, expect } from './fixtures'
import { getSupabase, createNotebook, createSection, createPage, waitForApp } from './test-helpers'

const BUCKET = 'tracker-images'

// Helper: upload a tiny 1x1 PNG to storage and return the storage path.
const uploadTestImage = async (client, userId, fileName) => {
  // Minimal valid 1x1 transparent PNG (67 bytes)
  const pngBytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02,
    0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
    0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ])
  const storagePath = `${userId}/${fileName}`
  const { error } = await client.storage
    .from(BUCKET)
    .upload(storagePath, pngBytes, { contentType: 'image/png', upsert: true })
  if (error) throw error
  return storagePath
}

// Helper: check if a file exists in storage.
const storageFileExists = async (client, storagePath) => {
  // createSignedUrl succeeds only if the file exists.
  const { data, error } = await client.storage.from(BUCKET).createSignedUrl(storagePath, 60)
  return !error && !!data?.signedUrl
}

// Helper: clean up a storage file (best-effort).
const cleanupStorageFile = async (client, storagePath) => {
  await client.storage.from(BUCKET).remove([storagePath]).catch(() => {})
}

// Build Tiptap JSON with an image node referencing a storage path.
const docWithImage = (storagePath, blockId = 'img-block') => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { id: blockId },
      content: [{ type: 'text', text: 'Some text before the image.' }],
    },
    {
      type: 'image',
      attrs: { src: null, alt: 'test image', storagePath },
    },
  ],
})

// Build Tiptap JSON with just text (no images).
const docWithoutImage = (blockId = 'text-block') => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { id: blockId },
      content: [{ type: 'text', text: 'Just text, no images.' }],
    },
  ],
})

test.describe('Issue #84 orphaned image cleanup', () => {
  // ---------- T1: Save with image removed → storage file deleted ----------
  test('T1: removing an image from a page cleans up storage after save', async ({ page }) => {
    const { client, userId } = await getSupabase()
    const storagePath = await uploadTestImage(client, userId, `t1-${Date.now()}.png`)

    // Verify file was uploaded
    expect(await storageFileExists(client, storagePath)).toBe(true)

    // Create test data: notebook → section → page with image
    const nb = await createNotebook(client, userId, `T1 Notebook ${Date.now()}`)
    const sec = await createSection(client, userId, nb.id, 'T1 Section')
    const pg = await createPage(client, userId, sec.id, 'T1 Page', docWithImage(storagePath))

    try {
      await waitForApp(page)

      // Navigate to the test page
      await page.click(`text=${nb.title}`)
      await page.click('text=T1 Section')
      await page.click('text=T1 Page')
      await page.waitForSelector('.tiptap', { timeout: 10000 })

      // Find and delete the image from the editor
      const img = page.locator('.tiptap img')
      await expect(img).toBeVisible({ timeout: 10000 })
      await img.click()
      await page.keyboard.press('Backspace')

      // Wait for auto-save (2s debounce + buffer)
      await page.waitForTimeout(4000)

      // Verify the image was deleted from storage
      expect(await storageFileExists(client, storagePath)).toBe(false)
    } finally {
      await cleanupStorageFile(client, storagePath)
    }
  })

  // ---------- T2: Save with no image changes → no storage calls ----------
  test('T2: editing text on a page with images does not delete them', async ({ page }) => {
    const { client, userId } = await getSupabase()
    const storagePath = await uploadTestImage(client, userId, `t2-${Date.now()}.png`)

    const nb = await createNotebook(client, userId, `T2 Notebook ${Date.now()}`)
    const sec = await createSection(client, userId, nb.id, 'T2 Section')
    await createPage(client, userId, sec.id, 'T2 Page', docWithImage(storagePath))

    try {
      await waitForApp(page)
      await page.click(`text=${nb.title}`)
      await page.click('text=T2 Section')
      await page.click('text=T2 Page')
      await page.waitForSelector('.tiptap', { timeout: 10000 })

      // Type some text (not touching the image)
      const editor = page.locator('.tiptap')
      await editor.click()
      await page.keyboard.type(' extra text')

      // Wait for auto-save
      await page.waitForTimeout(4000)

      // Image should still exist
      expect(await storageFileExists(client, storagePath)).toBe(true)
    } finally {
      await cleanupStorageFile(client, storagePath)
    }
  })

  // ---------- T3: Undo image removal before save → file NOT deleted ----------
  test('T3: undoing image removal before save preserves the storage file', async ({ page }) => {
    const { client, userId } = await getSupabase()
    const storagePath = await uploadTestImage(client, userId, `t3-${Date.now()}.png`)

    const nb = await createNotebook(client, userId, `T3 Notebook ${Date.now()}`)
    const sec = await createSection(client, userId, nb.id, 'T3 Section')
    await createPage(client, userId, sec.id, 'T3 Page', docWithImage(storagePath))

    try {
      await waitForApp(page)
      await page.click(`text=${nb.title}`)
      await page.click('text=T3 Section')
      await page.click('text=T3 Page')
      await page.waitForSelector('.tiptap', { timeout: 10000 })

      // Delete the image
      const img = page.locator('.tiptap img')
      await expect(img).toBeVisible({ timeout: 10000 })
      await img.click()
      await page.keyboard.press('Backspace')

      // Immediately undo (before the 2s debounce fires)
      const isMac = process.platform === 'darwin'
      await page.keyboard.press(isMac ? 'Meta+z' : 'Control+z')

      // Wait for auto-save
      await page.waitForTimeout(4000)

      // Image should still exist (undo restored it before the save)
      expect(await storageFileExists(client, storagePath)).toBe(true)
    } finally {
      await cleanupStorageFile(client, storagePath)
    }
  })

  // ---------- T4: Page deletion with images → storage cleaned ----------
  test('T4: deleting a page cleans up its images from storage', async ({ page }) => {
    const { client, userId } = await getSupabase()
    const storagePath = await uploadTestImage(client, userId, `t4-${Date.now()}.png`)

    const nb = await createNotebook(client, userId, `T4 Notebook ${Date.now()}`)
    const sec = await createSection(client, userId, nb.id, 'T4 Section')
    await createPage(client, userId, sec.id, 'T4 Page', docWithImage(storagePath))

    try {
      await waitForApp(page)
      await page.click(`text=${nb.title}`)
      await page.click('text=T4 Section')
      await page.click('text=T4 Page')
      await page.waitForSelector('.tiptap', { timeout: 10000 })

      // Set up dialog handler to auto-accept the delete confirmation
      page.on('dialog', (dialog) => dialog.accept())

      // Click the delete button for the page
      const deleteButton = page.getByRole('button', { name: /delete/i })
      await deleteButton.click()

      // Wait for deletion to complete
      await page.waitForTimeout(2000)

      // Image should be gone from storage
      expect(await storageFileExists(client, storagePath)).toBe(false)
    } finally {
      await cleanupStorageFile(client, storagePath)
    }
  })

  // ---------- T5: Section deletion with images → storage cleaned ----------
  test('T5: deleting a section cleans up images from all its pages', async ({ page }) => {
    const { client, userId } = await getSupabase()
    const storagePath1 = await uploadTestImage(client, userId, `t5a-${Date.now()}.png`)
    const storagePath2 = await uploadTestImage(client, userId, `t5b-${Date.now()}.png`)

    const nb = await createNotebook(client, userId, `T5 Notebook ${Date.now()}`)
    const sec = await createSection(client, userId, nb.id, 'T5 Section')
    await createPage(client, userId, sec.id, 'T5 Page 1', docWithImage(storagePath1, 'p1-img'))
    await createPage(client, userId, sec.id, 'T5 Page 2', docWithImage(storagePath2, 'p2-img'))

    try {
      await waitForApp(page)
      await page.click(`text=${nb.title}`)

      // Right-click the section to open context menu
      await page.click('text=T5 Section', { button: 'right' })

      // Set up dialog handler to auto-accept the delete confirmation
      page.on('dialog', (dialog) => dialog.accept())

      // Click delete in context menu
      const deleteOption = page.getByRole('menuitem', { name: /delete/i })
      await deleteOption.click()

      // Wait for deletion
      await page.waitForTimeout(2000)

      // Both images should be gone
      expect(await storageFileExists(client, storagePath1)).toBe(false)
      expect(await storageFileExists(client, storagePath2)).toBe(false)
    } finally {
      await cleanupStorageFile(client, storagePath1)
      await cleanupStorageFile(client, storagePath2)
    }
  })

  // ---------- T6: Notebook deletion with images → storage cleaned ----------
  test('T6: deleting a notebook cleans up images from all contained pages', async ({ page }) => {
    const { client, userId } = await getSupabase()
    const storagePath = await uploadTestImage(client, userId, `t6-${Date.now()}.png`)

    const nb = await createNotebook(client, userId, `T6 Notebook ${Date.now()}`)
    const sec = await createSection(client, userId, nb.id, 'T6 Section')
    await createPage(client, userId, sec.id, 'T6 Page', docWithImage(storagePath))

    try {
      await waitForApp(page)

      // Right-click the notebook to open context menu
      await page.click(`text=${nb.title}`, { button: 'right' })

      // Set up dialog handler to auto-accept the delete confirmation
      page.on('dialog', (dialog) => dialog.accept())

      // Click delete in context menu
      const deleteOption = page.getByRole('menuitem', { name: /delete/i })
      await deleteOption.click()

      // Wait for deletion
      await page.waitForTimeout(2000)

      // Image should be gone
      expect(await storageFileExists(client, storagePath)).toBe(false)
    } finally {
      await cleanupStorageFile(client, storagePath)
    }
  })

  // ---------- T7: deleteImagesFromStorage with empty array → no crash ----------
  test('T7: page without images can be deleted without errors', async ({ page }) => {
    const { client, userId } = await getSupabase()

    const nb = await createNotebook(client, userId, `T7 Notebook ${Date.now()}`)
    const sec = await createSection(client, userId, nb.id, 'T7 Section')
    await createPage(client, userId, sec.id, 'T7 Page', docWithoutImage())

    await waitForApp(page)
    await page.click(`text=${nb.title}`)
    await page.click('text=T7 Section')
    await page.click('text=T7 Page')
    await page.waitForSelector('.tiptap', { timeout: 10000 })

    // Set up dialog handler
    page.on('dialog', (dialog) => dialog.accept())

    // Delete page — should not crash
    const deleteButton = page.getByRole('button', { name: /delete/i })
    await deleteButton.click()

    // Wait and verify no error messages appeared
    await page.waitForTimeout(2000)

    // Page should be gone from the sidebar
    await expect(page.locator('text=T7 Page')).not.toBeVisible()
  })
})
