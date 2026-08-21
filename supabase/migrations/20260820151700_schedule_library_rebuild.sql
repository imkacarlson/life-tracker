-- Schedule the weekly Library rebuild. DELIBERATELY SPLIT from everything else:
-- nothing runs on a timer until the function has been verified by hand with
-- LIBRARY_DRY_RUN=1 and its output read. Apply this one LAST.
--
-- Same convention as 20260809233309_schedule_bot_reminders.sql, and the same
-- Vault-sourced secret.
--
-- SLOT: Sunday 04:07. This is the project's first WEEKLY job; the 4 AM hour
-- already holds four daily purges at minutes 17, 23, 29, and 35, so 07 is clear.
-- Sunday morning means Lately is fresh when the user looks at the week ahead.
select cron.schedule(
  'library-rebuild',
  '7 4 * * 0',
  $$
  select net.http_post(
    url := 'https://ogzpgnxmcifaqliuxxzu.supabase.co/functions/v1/library-rebuild',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1)
    ),
    body := '{}'::jsonb
  );
  $$
);
