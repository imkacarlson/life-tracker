-- Enable pg_cron and pg_net extensions
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- NOTE: Before this cron job will work, you must:
-- 1. Add a secret named 'cron_secret' to Supabase Vault (Dashboard → Project Settings → Vault)
-- 2. Add CRON_SECRET with the same value as a Supabase Edge Function secret
-- 3. Add RESEND_API_KEY as a Supabase Edge Function secret

-- Schedule check-scores every 15 minutes
select cron.schedule(
  'check-sports-scores',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://ogzpgnxmcifaqliuxxzu.supabase.co/functions/v1/check-scores',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1)
    ),
    body := '{}'::jsonb
  );
  $$
);
