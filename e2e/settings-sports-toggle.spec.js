/**
 * E2E coverage for the Sports Score Alerts switch in Settings.
 *
 * Asserts two different things that are easy to conflate, and only the second
 * proves the write actually landed:
 *   1. the optimistic flip (aria-checked + the visible On/Off label), and
 *   2. persistence across a full reload (a real Supabase round-trip).
 *
 * Runs on BOTH viewport projects deliberately — the card wraps its pill below
 * the description on a phone, which is exactly the layout worth covering.
 *
 * Settings-table cleanup is spec-local: e2e/fixtures.js's isolateSupabaseData
 * snapshots notebooks/sections/pages only, so a flipped toggle would otherwise
 * leak into every later spec and into the test account.
 */

import { test, expect } from './fixtures'
import { getSupabase, waitForApp } from './test-helpers'

const TOGGLE_NAME = 'Sports Score Alerts'

let originalEnabled = true

const setEnabled = async (value) => {
  const { client, userId } = await getSupabase()
  const { error } = await client
    .from('settings')
    .update({ sports_scores_enabled: value })
    .eq('user_id', userId)
  if (error) throw error
}

const openSettings = async (page) => {
  await page.getByRole('button', { name: 'Open account and settings menu' }).click()
  await page.getByRole('menuitem', { name: 'Settings' }).click()
  return page.getByRole('switch', { name: TOGGLE_NAME })
}

test.beforeAll(async () => {
  const { client, userId } = await getSupabase()
  const { data, error } = await client
    .from('settings')
    .select('sports_scores_enabled')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  // No row yet means the app has not bootstrapped settings for this account; the
  // column default is true, so that is the value to restore afterwards.
  originalEnabled = data?.sports_scores_enabled ?? true
  if (data) await setEnabled(true)
})

test.afterAll(async () => {
  const { client, userId } = await getSupabase()
  const { data } = await client
    .from('settings')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()
  if (data) await setEnabled(originalEnabled)
})

test('sports score alerts toggle flips and survives a reload', async ({ page }) => {
  // Editor first: Settings replaces it, and it is `settingsMode` state rather
  // than a route, so there is no '/settings' hash to wait on.
  await waitForApp(page, '/')

  const toggle = await openSettings(page)
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect(toggle).toHaveText('On')

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await expect(toggle).toHaveText('Off')

  // A full reload is what separates the optimistic flip from a landed write.
  await waitForApp(page, '/')
  const afterReload = await openSettings(page)
  await expect(afterReload).toHaveAttribute('aria-checked', 'false')
  await expect(afterReload).toHaveText('Off')

  // Back on, and that write persists too.
  await afterReload.click()
  await expect(afterReload).toHaveAttribute('aria-checked', 'true')

  await waitForApp(page, '/')
  await expect(await openSettings(page)).toHaveAttribute('aria-checked', 'true')
})
