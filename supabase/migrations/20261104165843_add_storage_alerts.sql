-- Storage alerts: nothing in the activity log, page history or recordings is
-- ever purged, so instead the storage-alerts edge function checks usage once a
-- day and emails the owner at 50 / 70 / 85 / 95% of the free-tier limits.
--
-- Service-role only, like sports_check_health: RLS on with no policy.

-- One row per day, so the email can say how fast usage is growing.
create table public.storage_usage_samples (
  sampled_on date primary key,
  db_bytes bigint not null,
  storage_bytes bigint not null,
  created_at timestamptz not null default now()
);

alter table public.storage_usage_samples enable row level security;

-- Which warning levels have been emailed, so each level is sent once. Rows
-- above the current usage are cleared after a cleanup, re-arming them.
create table public.storage_alerts_sent (
  resource text not null check (resource in ('database', 'file_storage')),
  threshold int not null,
  sent_at timestamptz not null default now(),
  primary key (resource, threshold)
);

alter table public.storage_alerts_sent enable row level security;

-- Current usage. File storage size comes from object metadata, the same
-- number the Supabase dashboard bills against.
create or replace function public.storage_usage()
returns table (db_bytes bigint, storage_bytes bigint)
language sql
security definer
set search_path = ''
as $$
  select
    pg_database_size(current_database())::bigint,
    coalesce((select sum((o.metadata->>'size')::bigint) from storage.objects o), 0)::bigint
$$;

revoke all on function public.storage_usage() from public, anon, authenticated;
grant execute on function public.storage_usage() to service_role;

-- Daily at 13:53 UTC (morning Eastern), same Vault secret as send-bot-reminders.
select cron.schedule(
  'check-storage-usage',
  '53 13 * * *',
  $$
  select net.http_post(
    url := 'https://ogzpgnxmcifaqliuxxzu.supabase.co/functions/v1/storage-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1)
    ),
    body := '{}'::jsonb
  );
  $$
);
