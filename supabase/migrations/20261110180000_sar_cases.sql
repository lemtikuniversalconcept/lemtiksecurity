-- ============================================================
-- Search and rescue plans. A plan starts from a last known position
-- (usually a man-overboard or SOS alert) and the drift model estimates
-- where the person or boat is now. Inputs are stored; the search area is
-- recomputed on demand from them and the wind forecast.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sar_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  subject_id uuid REFERENCES public.movement_subjects(id) ON DELETE SET NULL,
  voyage_id uuid REFERENCES public.movement_voyages(id) ON DELETE SET NULL,
  alert_id uuid REFERENCES public.movement_alerts(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'found', 'stood_down')),
  object_type text NOT NULL CHECK (object_type IN ('person_in_water', 'person_with_lifejacket', 'life_raft', 'small_boat', 'disabled_powerboat', 'canoe')),
  persons integer CHECK (persons BETWEEN 0 AND 5000),
  lkp_lat double precision NOT NULL CHECK (lkp_lat BETWEEN -90 AND 90),
  lkp_lng double precision NOT NULL CHECK (lkp_lng BETWEEN -180 AND 180),
  lkp_at timestamptz NOT NULL,
  lkp_error_m integer NOT NULL DEFAULT 100 CHECK (lkp_error_m BETWEEN 5 AND 20000),
  current_kn numeric(4,2) CHECK (current_kn BETWEEN 0 AND 8),
  current_toward_deg integer CHECK (current_toward_deg BETWEEN 0 AND 359),
  notes text CHECK (char_length(notes) <= 2000),
  outcome text CHECK (char_length(outcome) <= 2000),
  created_by uuid NOT NULL,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE INDEX IF NOT EXISTS sar_cases_org_idx ON public.sar_cases (organisation_id, status, created_at DESC);
ALTER TABLE public.sar_cases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sar_cases_read" ON public.sar_cases;
CREATE POLICY "sar_cases_read" ON public.sar_cases FOR SELECT TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin']::public.app_role[]));
DROP POLICY IF EXISTS "sar_cases_insert" ON public.sar_cases;
CREATE POLICY "sar_cases_insert" ON public.sar_cases FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor']::public.app_role[]));
DROP POLICY IF EXISTS "sar_cases_update" ON public.sar_cases;
CREATE POLICY "sar_cases_update" ON public.sar_cases FOR UPDATE TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor']::public.app_role[]))
  WITH CHECK (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor']::public.app_role[]));
