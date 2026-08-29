-- Reconcile the check-scores cron job with the repo.
--
-- On 2026-08-27 the job was paused by hand (`cron.alter_job(1, active := false)`)
-- while ESPN was returning 403. That change lived only in the live database:
-- 20260403005828_add_pg_cron_scores.sql still declares an active */15 job, so a
-- `db reset` would resurrect the 403 spam.
--
-- This sets the state deterministically and keys on JOBNAME, not `jobid = 1`.
-- Job ids are assigned by sequence and are not stable across a rebuild, so the
-- hardcoded 1 used interactively would target a different job in a fresh
-- database.
--
-- SEQUENCING: apply this only AFTER the rewritten check-scores function is
-- deployed. Re-enabling against the old code resumes the 403s.
do $$
declare
  target_jobid bigint;
begin
  select jobid into target_jobid
  from cron.job
  where jobname = 'check-sports-scores';

  if target_jobid is null then
    raise notice 'check-sports-scores job not found; nothing to reconcile';
  else
    perform cron.alter_job(target_jobid, active := true);
  end if;
end
$$;
