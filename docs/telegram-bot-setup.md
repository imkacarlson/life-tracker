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
  TELEGRAM_ALLOWED_USER_ID='<your numeric id>' \
  USER_TIMEZONE='America/New_York'
```

`ANTHROPIC_API_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` are already configured.

### `/blog` command secrets (GRC blog drafter)

The `/blog` command formats a pasted race recap into WordPress block markup and creates a **draft**
post on grcrunning.com. It needs WordPress credentials plus the one-shot formatting example:

```bash
supabase secrets set \
  WP_USER='<wordpress username>' \
  WP_APP_PASSWORD='<wordpress application password>'

# The few-shot example is kept out of the git repo and supplied as a secret.
# Put the real INPUT/OUTPUT example in a local file (e.g. blog-example.txt) and:
supabase secrets set BLOG_EXAMPLE="$(cat blog-example.txt)"
```

- `WP_USER` / `WP_APP_PASSWORD` — a WordPress [Application Password](https://www.grcrunning.com/wp-admin/profile.php)
  (Users → Profile → Application Passwords). Use an app password, not the account login password.
- `WP_POSTS_ENDPOINT` — optional; defaults to `https://www.grcrunning.com/wp-json/wp/v2/posts`.
- `BLOG_EXAMPLE` — the full one-shot formatting example (a previous week's raw recap as the INPUT
  and the desired WordPress block markup as the OUTPUT). It teaches Claude the two-column layout and
  profile-link format. It contains real athlete names, so it is **not** committed — it lives only as
  this secret. `prompt.ts` injects it at request time and fails loudly (`⚠️ Blog draft failed: …`)
  if it's unset, rather than prompting without an example.
- `ANTHROPIC_API_KEY` (already set above) is reused for the formatting call.

The team rosters are fetched live from the site at request time, so there's nothing to keep in sync.

> The format the example should follow is captured in the original drafter at
> `~/projects/grc-blog-drafter-flow/prompt_data.py` (`EXAMPLE_INPUT` / `EXAMPLE_OUTPUT`). Paste that
> exact INPUT:/OUTPUT: block into the `BLOG_EXAMPLE` secret.

`USER_TIMEZONE` is your local [IANA time zone](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)
name (e.g. `America/New_York`). The bot uses it to know what "today"/"now" means and to pick the
right month's tracker — Telegram doesn't send your device's time zone, so it has to be configured
here. It defaults to `America/New_York` if unset; set it explicitly. If you relocate to a different
time zone long-term, update this secret (no redeploy needed — it takes effect on the next message).
Short trips aren't worth changing; the bot doesn't track travel automatically.

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
- `/blog <paste a race recap>` creates a WordPress draft and replies with the edit link. Bare
  `/blog` with no text returns a usage hint. On any failure (roster fetch, Claude, WordPress) it
  replies `⚠️ Blog draft failed: <reason>` rather than posting a blank or broken draft.

## How it works (quick reference)

- **Auth:** the webhook secret-token header (verified by grammY) + a check that the sender and chat
  both equal `TELEGRAM_ALLOWED_USER_ID`. Replies are pinned to your chat only.
- **Memory:** none on the side. The bot's only context is the live tracker (read on demand) and the
  current conversation (idle window ~30 min, last 12 turns).
- **Data:** it reads only the `is_tracker_page` page whose title matches the current month/year
  (e.g. "May 2026 Tracker"), falling back to the most recently updated tracker page.
- **Tools:** capabilities are a pluggable registry (`tools.ts`). v1 has one read-only tool,
  `read_current_tracker`. Future features get added there.
