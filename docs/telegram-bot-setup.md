# Telegram bot setup

The `telegram-bot` edge function lets you chat with your life tracker from Telegram.
v1 is read-only Q&A over the **current month's** tracker page.

These steps require your Telegram and Supabase access, so they can't be done from a code session.

## 1. Create the bot

1. In Telegram, message **@BotFather** → `/newbot` → follow the prompts.
2. Copy the **bot token** it gives you (looks like `123456:ABC-DEF...`).

## 2. Find your Telegram user ID

Message **@userinfobot** (or **@RawDataBot**) and copy the numeric **id** it reports.
This is your `TELEGRAM_ALLOWED_USER_ID` — the bot only ever responds to this account,
and only in your private chat with it.

## 3. Set the edge-function secrets

Pick a long random string for the webhook secret (e.g. `openssl rand -hex 32`).

```bash
supabase secrets set \
  TELEGRAM_BOT_TOKEN='<token from BotFather>' \
  TELEGRAM_WEBHOOK_SECRET='<random string>' \
  TELEGRAM_ALLOWED_USER_ID='<your numeric id>'
```

`ANTHROPIC_API_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` are already configured.

## 4. Deploy the function

```bash
supabase functions deploy telegram-bot
```

(Or use the Supabase MCP `deploy_edge_function` tool.)

## 5. Register the webhook

Point Telegram at the deployed function and pass the same secret. The function URL is
`https://<project-ref>.supabase.co/functions/v1/telegram-bot`.

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://<project-ref>.supabase.co/functions/v1/telegram-bot" \
  -d "secret_token=<your TELEGRAM_WEBHOOK_SECRET>"
```

Check it registered cleanly (no `last_error_message`, no pending errors):

```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

## 6. Try it

Message your bot. Some things to confirm:

- It answers questions about the current month's tracker (including crossed-off items).
- A message from a different Telegram account gets no response.
- `/new` starts a fresh conversation; replying within ~30 min continues the previous one.
- The "typing…" indicator shows while it works.

## How it works (quick reference)

- **Auth:** the webhook secret-token header (verified by grammY) + a check that the sender and chat
  both equal `TELEGRAM_ALLOWED_USER_ID`. Replies are pinned to your chat only.
- **Memory:** none on the side. The bot's only context is the live tracker (read on demand) and the
  current conversation (idle window ~30 min, last 12 turns).
- **Data:** it reads only the `is_tracker_page` page whose title matches the current month/year
  (e.g. "May 2026 Tracker"), falling back to the most recently updated tracker page.
- **Tools:** capabilities are a pluggable registry (`tools.ts`). v1 has one read-only tool,
  `read_current_tracker`. Future features get added there.
