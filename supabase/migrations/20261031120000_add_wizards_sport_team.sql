-- Track the Washington Wizards (NBA, ESPN team id 27).
--
-- check-scores only seeds sport_teams when the table is empty, so adding the
-- team to SEED_TEAMS alone never reaches an existing database. Owned by the same
-- user as the existing teams, and idempotent so a re-run is a no-op.
--
-- No extra ESPN traffic: the Wizards share the NBA scoreboard request with the
-- Pacers (same URL, per-run cache, and one shared next_poll_at per league).

insert into public.sport_teams
  (user_id, name, display_name, sport, league, espn_team_id, emoji_win, emoji_loss, emoji_tie)
select
  user_id, 'wizards', 'Washington Wizards', 'basketball', 'nba', '27', '🏀🏆', '🏀❌', '🏀🤝'
from public.sport_teams
where name = 'pacers'
  and not exists (select 1 from public.sport_teams where name = 'wizards')
limit 1;
