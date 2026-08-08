-- Deep-thinking mode is sticky for the life of a bot session: /think turns it on,
-- /new closes the session and the next message starts fresh at 'standard'.
alter table public.bot_sessions
  add column mode text not null default 'standard'
  check (mode in ('standard', 'think'));
