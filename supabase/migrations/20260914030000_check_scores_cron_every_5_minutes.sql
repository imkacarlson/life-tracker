-- Run check-scores every 5 minutes instead of every 15.
--
-- Context: a game whose AI summary fails is now held back rather than emailed
-- immediately, so a later run can try the summary again — see
-- SUMMARY_HOLD_MINUTES in the function. That hold is capped at 5 minutes, and a
-- 5-minute promise needs ticks more often than every 15.
--
-- ESPN traffic does NOT increase. nextPollDelayMinutes has a 15-minute floor
-- (LIVE_POLL_MINUTES) and sport_teams.next_poll_at still gates every team, so
-- the extra ticks are cheap no-ops: a run with no team due took 10.4s and made
-- zero ESPN requests. Invocations go from ~96 to ~288/day, well inside the free
-- tier.
--
-- Keyed on JOBNAME, not `jobid = 1`, for the same reason as
-- 20260829161700_reconcile_check_sports_scores_cron.sql: job ids come from a
-- sequence and are not stable across a database rebuild.
--
-- SEQUENCING: apply this only AFTER the function that holds emails is deployed.
-- Against the old code the extra ticks are harmless but pointless.
do $$
declare
  target_jobid bigint;
begin
  select jobid into target_jobid
  from cron.job
  where jobname = 'check-sports-scores';

  if target_jobid is null then
    raise notice 'check-sports-scores job not found; nothing to reschedule';
  else
    perform cron.alter_job(target_jobid, schedule := '*/5 * * * *');
  end if;
end
$$;
