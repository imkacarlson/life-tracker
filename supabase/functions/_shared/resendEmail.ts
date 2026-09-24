// Resend email delivery, shared by check-scores and auth-alerts.
//
// Sends from Resend's shared onboarding@resend.dev address, which Resend only
// delivers to the Resend account owner — i.e. OWNER_EMAIL.

export const OWNER_EMAIL = 'imkacarlson@gmail.com'

export async function sendEmail(
  resendApiKey: string,
  to: string,
  subject: string,
  html: string,
  fromName: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: `${fromName} <onboarding@resend.dev>`,
        to: [to],
        subject,
        html,
      }),
    })

    if (!resp.ok) {
      const errBody = await resp.text()
      console.error('Resend error:', errBody)
      return { ok: false, error: `Resend ${resp.status}: ${errBody}` }
    }

    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}
