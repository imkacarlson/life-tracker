-- Retention for the conversation log. bot_sessions / bot_messages had none: every
-- turn ever sent to the bot was kept forever, while only the last 12 turns of an
-- active session are ever read back (telegram-bot/index.ts MAX_TURNS). Deleting a
-- session cascades to its messages via the existing FK
-- (20260530004356_add_bot_tables.sql). The idle window that starts a new session
-- is 30 minutes, so anything untouched for 90 days is definitively dead.
--
-- pg_cron is already enabled (see 20260403005828_add_pg_cron_scores.sql). 4 AM at
-- an unused minute — 17 and 23 belong to purge-bot-preview-jobs / purge-bot-reminders.
select cron.schedule(
  'purge-bot-sessions',
  '29 4 * * *',
  $$ delete from public.bot_sessions where last_activity_at < now() - interval '90 days' $$
);
