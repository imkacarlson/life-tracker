-- Retention for the Library activity log.
--
-- Each rebuild row carries prev_content — the page's full document from before
-- the rebuild wrote it. That is the revert payload, so these rows are not free:
-- without a sweep, every weekly rebuild would leave a permanent copy of every
-- rebuilt page behind forever.
--
-- 90 days matches the bot_sessions / bot_reminders retention. Reverting a
-- rebuild is something the user does when they notice a page got worse, which
-- is days later at most — three months is generous.
--
-- pg_cron is already enabled (see 20260403005828_add_pg_cron_scores.sql). 4 AM
-- at an unused minute: 17, 23, and 29 belong to purge-bot-preview-jobs,
-- purge-bot-reminders, and purge-bot-sessions.
select cron.schedule(
  'purge-library-activity',
  '35 4 * * *',
  $$ delete from public.library_activity where created_at < now() - interval '90 days' $$
);
