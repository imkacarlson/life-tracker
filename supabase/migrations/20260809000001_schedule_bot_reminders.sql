-- Schedule the reminder sweep. DELIBERATELY SPLIT from the table migration:
-- nothing runs on a timer until the function has been verified by hand with
-- REMINDER_DRY_RUN=1. Apply this one LAST.
--
-- pg_cron is already enabled (see 20260329000001_add_pg_cron_scores.sql).

-- Retention. A purged row would be re-derived, but its fire_at is then far past
-- and the sweep's 2h grace filter rejects it — so 90 days is three orders of
-- magnitude more margin than the backfill guard needs.
select cron.schedule(
  'purge-bot-reminders',
  '23 4 * * *',
  $$ delete from public.bot_reminders where fire_at < now() - interval '90 days' $$
);

-- Every 5 minutes. 288 invocations/day (~8.6K/month against a 500K free tier),
-- ~1s each, and zero AI tokens — extraction is pure regex over document JSON.
--
-- Same Vault-sourced secret check-scores uses (see the migration above).
select cron.schedule(
  'send-bot-reminders',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://ogzpgnxmcifaqliuxxzu.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1)
    ),
    body := '{}'::jsonb
  );
  $$
);
