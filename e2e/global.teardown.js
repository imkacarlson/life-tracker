import { getSupabase, purgeTestUserData } from './test-helpers'

export default async function globalTeardown() {
  if (!process.env.TEST_USER_EMAIL || !process.env.TEST_USER_PASSWORD) {
    console.warn('[teardown] TEST_USER_EMAIL / TEST_USER_PASSWORD not set — skipping purge')
    return
  }
  try {
    const { client, userId } = await getSupabase()
    await purgeTestUserData(client, userId)

    // Three places sign the test user in — auth.setup.js (browser, persisted to
    // playwright/.auth/user.json), test-helpers.js, and fixtures.js — and none
    // signed out, so every run left behind auth.sessions rows that never expire.
    // The two Node clients are memoized inside worker processes this teardown
    // cannot reach, so revoke by scope instead: `global` kills every session for
    // the user, covering all three. Safe only because this is a dedicated test
    // account.
    await client.auth.signOut({ scope: 'global' })
  } catch (err) {
    console.warn('[teardown] purge/sign-out failed (non-fatal):', err?.message ?? err)
  }
}
