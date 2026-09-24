-- Sign-in alerts: email the owner when an account signs in from a device or
-- network it hasn't used before, when a live session jumps to a new network
-- (a copied/stolen refresh token), or when any new account is created.
--
-- Flow: trigger on auth.sessions / auth.users -> pg_net POST (async, so it
-- never slows or blocks a login) -> auth-alerts edge function, which decides
-- whether the event is new and sends the email via Resend.
--
-- Deploy the auth-alerts function BEFORE applying this migration, or the
-- first few events will 404.

-- What the alerter has already seen, per user. 'device' values are a coarse
-- "Chrome on Windows" label (built by the edge function); 'network' values are
-- the IP's /16 (IPv4) or /32 (IPv6) prefix, computed in the trigger below so
-- there is exactly one canonical text form.
create table public.auth_known_origins (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('device', 'network')),
  value text not null,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (user_id, kind, value)
);

-- RLS on with no policies: only the service role (the edge function) can
-- read or write it. The browser never needs this table.
alter table public.auth_known_origins enable row level security;

-- Network prefix used for "have we seen this network before". /16 is coarse on
-- purpose: phones on mobile data hop between addresses constantly, and a
-- per-address check would email on every hop.
create or replace function public.auth_alert_network(addr inet)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when addr is null then null
    else network(set_masklen(addr, case when family(addr) = 4 then 16 else 32 end))::text
  end
$$;

create or replace function public.notify_auth_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  payload jsonb;
  account_email text;
begin
  if tg_table_name = 'users' then
    payload := jsonb_build_object(
      'type', 'user_created',
      'user_id', new.id,
      'email', new.email,
      'at', now()
    );
  else
    select u.email into account_email from auth.users u where u.id = new.user_id;
    payload := jsonb_build_object(
      'type', case when tg_op = 'INSERT' then 'session_created' else 'session_ip_changed' end,
      'user_id', new.user_id,
      'email', account_email,
      'session_id', new.id,
      'ip', host(new.ip),
      'network', public.auth_alert_network(new.ip),
      'user_agent', new.user_agent,
      'at', now()
    );
    if tg_op = 'UPDATE' then
      payload := payload || jsonb_build_object('previous_ip', host(old.ip));
    end if;
  end if;

  perform net.http_post(
    url := 'https://ogzpgnxmcifaqliuxxzu.supabase.co/functions/v1/auth-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1)
    ),
    body := payload
  );
  return new;
exception when others then
  -- An alerting bug must never break sign-in. Log and carry on.
  raise warning 'notify_auth_event failed: %', sqlerrm;
  return new;
end;
$$;

-- Trigger functions can't be called over the REST API anyway, but don't leave
-- a security-definer function executable by client roles.
revoke execute on function public.notify_auth_event() from public, anon, authenticated;

create trigger auth_alert_session_created
  after insert on auth.sessions
  for each row execute function public.notify_auth_event();

-- Refreshing a token rewrites the session's ip. Only a CHANGE is interesting.
create trigger auth_alert_session_ip_changed
  after update on auth.sessions
  for each row
  when (old.ip is distinct from new.ip)
  execute function public.notify_auth_event();

create trigger auth_alert_user_created
  after insert on auth.users
  for each row execute function public.notify_auth_event();

-- Seed the networks of the sessions that exist today so deploying doesn't
-- email about devices already in use. (Device labels are seeded by a one-off
-- 'seed' call to the edge function, since the label is built there.)
insert into public.auth_known_origins (user_id, kind, value)
select distinct s.user_id, 'network', public.auth_alert_network(s.ip)
from auth.sessions s
where s.ip is not null
on conflict do nothing;
