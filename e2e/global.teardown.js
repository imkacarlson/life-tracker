import { getSupabase, purgeTestUserData } from './test-helpers'

export default async function globalTeardown() {
  if (!process.env.TEST_USER_EMAIL || !process.env.TEST_USER_PASSWORD) {
    console.warn('[teardown] TEST_USER_EMAIL / TEST_USER_PASSWORD not set — skipping purge')
    return
  }
  try {
    const { client, userId } = await getSupabase()
    await purgeTestUserData(client, userId)
  } catch (err) {
    console.warn('[teardown] purgeTestUserData failed (non-fatal):', err?.message ?? err)
  }
}
