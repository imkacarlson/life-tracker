-- Retention for the pg_cron run logbook. cron.job_run_details records one row per
-- scheduled job run and nothing has ever deleted from it: at the time of writing it
-- held ~20k rows / 10 MB going back to 2026-04-03, the day the first job was created
-- (20260403005828_add_pg_cron_scores.sql). Current write rate is ~388 rows/day
-- (send-bot-reminders */5 and check-sports-scores */15 dominate), so it grows about
-- 6 MB a month forever.
--
-- 30 days is long enough to investigate a job that has been quietly failing for a few
-- weeks — exactly the check-sports-scores failure mode — and caps the table near 12k
-- rows. Filter on start_time, not end_time: end_time is null for a run still in flight,
-- so those rows would never be eligible.
--
-- Clear the existing backlog once here so the cap takes effect immediately rather than
-- at the first 4 AM run. No VACUUM — it cannot run inside a migration transaction, and
-- autovacuum reclaims the space on its own.
delete from cron.job_run_details where start_time < now() - interval '30 days';

-- 4 AM at an unused minute — 17, 23, 29, and 35 belong to purge-bot-preview-jobs,
-- purge-bot-reminders, purge-bot-sessions, and purge-library-activity.
select cron.schedule(
  'purge-cron-job-run-details',
  '41 4 * * *',
  $$ delete from cron.job_run_details where start_time < now() - interval '30 days' $$
);
