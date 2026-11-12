-- Checklists for each security level.
--
--   isps_facilities.posts           the facility's guard posts: [{id, name}]
--   isps_facilities.level_measures  measures for each level from the security plan:
--                                   {"1": [{text, post_id|null}], "2": [...], "3": [...]}
--   isps_checklist_runs             when the level changes, one checklist per post, ticked off
--                                   by whoever is on duty there, with the time of each tick

ALTER TABLE public.isps_facilities
  ADD COLUMN IF NOT EXISTS posts jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS level_measures jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.isps_checklist_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES public.isps_facilities(id) ON DELETE CASCADE,
  level_change_id uuid REFERENCES public.isps_level_changes(id) ON DELETE SET NULL,
  level smallint NOT NULL CHECK (level BETWEEN 1 AND 3),
  post_id text,
  post_name text NOT NULL,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{text, done_at, done_by, done_by_name}]
  version integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  first_tick_at timestamptz,
  completed_at timestamptz,
  superseded_at timestamptz
);
CREATE INDEX IF NOT EXISTS isps_checklist_runs_open_idx ON public.isps_checklist_runs (organisation_id, started_at DESC) WHERE completed_at IS NULL AND superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS isps_checklist_runs_fac_idx ON public.isps_checklist_runs (facility_id, started_at DESC);
ALTER TABLE public.isps_checklist_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "isps_checklist_runs_read" ON public.isps_checklist_runs;
CREATE POLICY "isps_checklist_runs_read" ON public.isps_checklist_runs FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organisation_id));
-- Written by the server only.
