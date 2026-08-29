-- Settings toggle for the automatic sports score emails.
--
-- `default true` is load-bearing: useSettings.loadSettings auto-inserts a row
-- with only {user_id, daily_template_content}, so a NOT NULL column without a
-- default would break account bootstrap.
--
-- NOTE: there is no `create table public.settings` anywhere in this migration
-- history — the table predates it. `if not exists` keeps this ALTER idempotent
-- against the live database; a from-scratch `supabase db reset` is already
-- broken for `settings` and is tracked separately.
alter table public.settings
  add column if not exists sports_scores_enabled boolean not null default true;

-- RLS needs no work here: policies on `settings` are row-level and the table
-- already carries the full four-policy set. `settings.user_id` already has a
-- unique index (settings_user_id_key), which is what keeps the edge function's
-- `.limit(1).maybeSingle()` read honest.
