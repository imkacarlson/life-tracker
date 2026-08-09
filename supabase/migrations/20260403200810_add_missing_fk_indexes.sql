-- Add missing foreign key indexes flagged by Supabase performance advisor

-- Hot query paths
CREATE INDEX IF NOT EXISTS pages_section_sort_idx ON public.pages (section_id, sort_order NULLS LAST);
CREATE INDEX IF NOT EXISTS sections_notebook_id_idx ON public.sections (notebook_id);

-- RLS evaluation columns
CREATE INDEX IF NOT EXISTS pages_user_id_idx ON public.pages (user_id);
CREATE INDEX IF NOT EXISTS sections_user_id_idx ON public.sections (user_id);
CREATE INDEX IF NOT EXISTS notebooks_user_id_idx ON public.notebooks (user_id);
CREATE INDEX IF NOT EXISTS sport_teams_user_id_idx ON public.sport_teams (user_id);

-- FK columns used in RLS subquery joins
CREATE INDEX IF NOT EXISTS score_history_team_id_idx ON public.score_history (team_id);
CREATE INDEX IF NOT EXISTS notification_log_score_history_id_idx ON public.notification_log (score_history_id);

-- Range delete support for check-scores cleanup
CREATE INDEX IF NOT EXISTS score_history_created_at_idx ON public.score_history (created_at);
CREATE INDEX IF NOT EXISTS notification_log_created_at_idx ON public.notification_log (created_at);
