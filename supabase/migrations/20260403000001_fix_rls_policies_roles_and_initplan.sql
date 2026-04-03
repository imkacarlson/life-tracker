-- Fix RLS policies:
-- 1. Use (select auth.uid()) instead of auth.uid() for initplan optimization
-- 2. Change sport_teams/score_history/notification_log from public to authenticated role
-- 3. Add missing WITH CHECK on sport_teams UPDATE policy

-- ============================================================
-- NOTEBOOKS (role already authenticated, fix initplan only)
-- ============================================================
DROP POLICY IF EXISTS "Users can read their notebooks" ON public.notebooks;
CREATE POLICY "Users can read their notebooks"
  ON public.notebooks FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert their notebooks" ON public.notebooks;
CREATE POLICY "Users can insert their notebooks"
  ON public.notebooks FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their notebooks" ON public.notebooks;
CREATE POLICY "Users can update their notebooks"
  ON public.notebooks FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete their notebooks" ON public.notebooks;
CREATE POLICY "Users can delete their notebooks"
  ON public.notebooks FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ============================================================
-- SECTIONS (role already authenticated, fix initplan only)
-- ============================================================
DROP POLICY IF EXISTS "Users can read their sections" ON public.sections;
CREATE POLICY "Users can read their sections"
  ON public.sections FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert their sections" ON public.sections;
CREATE POLICY "Users can insert their sections"
  ON public.sections FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their sections" ON public.sections;
CREATE POLICY "Users can update their sections"
  ON public.sections FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete their sections" ON public.sections;
CREATE POLICY "Users can delete their sections"
  ON public.sections FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ============================================================
-- PAGES (role already authenticated, fix initplan only)
-- ============================================================
DROP POLICY IF EXISTS "Users can read their trackers" ON public.pages;
CREATE POLICY "Users can read their trackers"
  ON public.pages FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert their trackers" ON public.pages;
CREATE POLICY "Users can insert their trackers"
  ON public.pages FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their trackers" ON public.pages;
CREATE POLICY "Users can update their trackers"
  ON public.pages FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete their trackers" ON public.pages;
CREATE POLICY "Users can delete their trackers"
  ON public.pages FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ============================================================
-- SETTINGS (role already authenticated, fix initplan only)
-- ============================================================
DROP POLICY IF EXISTS "Users can read their settings" ON public.settings;
CREATE POLICY "Users can read their settings"
  ON public.settings FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert their settings" ON public.settings;
CREATE POLICY "Users can insert their settings"
  ON public.settings FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their settings" ON public.settings;
CREATE POLICY "Users can update their settings"
  ON public.settings FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete their settings" ON public.settings;
CREATE POLICY "Users can delete their settings"
  ON public.settings FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ============================================================
-- SPORT_TEAMS (fix role public->authenticated, fix initplan, add WITH CHECK on UPDATE)
-- ============================================================
DROP POLICY IF EXISTS "Users can read their sport_teams" ON public.sport_teams;
CREATE POLICY "Users can read their sport_teams"
  ON public.sport_teams FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert their sport_teams" ON public.sport_teams;
CREATE POLICY "Users can insert their sport_teams"
  ON public.sport_teams FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their sport_teams" ON public.sport_teams;
CREATE POLICY "Users can update their sport_teams"
  ON public.sport_teams FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete their sport_teams" ON public.sport_teams;
CREATE POLICY "Users can delete their sport_teams"
  ON public.sport_teams FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ============================================================
-- SCORE_HISTORY (fix role public->authenticated, fix initplan)
-- ============================================================
DROP POLICY IF EXISTS "Users can read their score_history" ON public.score_history;
CREATE POLICY "Users can read their score_history"
  ON public.score_history FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sport_teams st
    WHERE st.id = score_history.team_id
    AND st.user_id = (select auth.uid())
  ));

-- ============================================================
-- NOTIFICATION_LOG (fix role public->authenticated, fix initplan)
-- ============================================================
DROP POLICY IF EXISTS "Users can read their notification_log" ON public.notification_log;
CREATE POLICY "Users can read their notification_log"
  ON public.notification_log FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.score_history sh
    JOIN public.sport_teams st ON st.id = sh.team_id
    WHERE sh.id = notification_log.score_history_id
    AND st.user_id = (select auth.uid())
  ));
