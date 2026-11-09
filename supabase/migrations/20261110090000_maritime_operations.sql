-- ============================================================
-- Maritime operations on top of Protected Movement:
--   * crew "All OK" check-ins on a schedule, with a missed check-in alert;
--   * unexpected-stop alerts (a boat stopped or drifting where it shouldn't be);
--   * man-overboard alerts from the crew's phone;
--   * voyages: planned route with a corridor, planned departure/arrival,
--     crew list, head counts at departure and arrival, off-route and
--     overdue alerts, and a voyage report.
-- ============================================================

ALTER TABLE public.movement_subjects
  ADD COLUMN IF NOT EXISTS checkin_every_minutes INTEGER
    CHECK (checkin_every_minutes IS NULL OR checkin_every_minutes BETWEEN 5 AND 1440),
  ADD COLUMN IF NOT EXISTS last_checkin_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS checkin_overdue BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tracking_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stop_alert_minutes INTEGER
    CHECK (stop_alert_minutes IS NULL OR stop_alert_minutes BETWEEN 5 AND 720),
  ADD COLUMN IF NOT EXISTS stopped_since TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stop_alerted BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.movement_voyages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES public.movement_subjects(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'underway', 'completed', 'cancelled')),
  route JSONB NOT NULL DEFAULT '[]'::jsonb,          -- [[lng, lat], ...] planned waypoints
  corridor_m INTEGER NOT NULL DEFAULT 2000 CHECK (corridor_m BETWEEN 100 AND 50000),
  planned_departure TIMESTAMPTZ,
  planned_arrival TIMESTAMPTZ,
  departed_at TIMESTAMPTZ,
  arrived_at TIMESTAMPTZ,
  crew JSONB NOT NULL DEFAULT '[]'::jsonb,           -- [{ "name": "...", "role": "..." }]
  departure_count INTEGER CHECK (departure_count IS NULL OR departure_count BETWEEN 0 AND 5000),
  arrival_count INTEGER CHECK (arrival_count IS NULL OR arrival_count BETWEEN 0 AND 5000),
  off_route BOOLEAN NOT NULL DEFAULT false,
  overdue_alerted BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS movement_voyages_org_idx ON public.movement_voyages(organisation_id, created_at DESC);
-- A boat or vehicle can only be on one voyage at a time.
CREATE UNIQUE INDEX IF NOT EXISTS movement_voyages_one_underway ON public.movement_voyages(subject_id) WHERE status = 'underway';

DROP TRIGGER IF EXISTS movement_voyages_updated_at ON public.movement_voyages;
CREATE TRIGGER movement_voyages_updated_at BEFORE UPDATE ON public.movement_voyages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.movement_voyages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "movement_voyages_read" ON public.movement_voyages;
CREATE POLICY "movement_voyages_read" ON public.movement_voyages FOR SELECT TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin']::public.app_role[]));
DROP POLICY IF EXISTS "movement_voyages_write" ON public.movement_voyages;
CREATE POLICY "movement_voyages_write" ON public.movement_voyages FOR ALL TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin']::public.app_role[]))
  WITH CHECK (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin']::public.app_role[]));

-- Alerts: new kinds, and a link to the voyage they happened on.
ALTER TABLE public.movement_alerts
  ADD COLUMN IF NOT EXISTS voyage_id UUID REFERENCES public.movement_voyages(id) ON DELETE SET NULL;
ALTER TABLE public.movement_alerts DROP CONSTRAINT IF EXISTS movement_alerts_kind_check;
ALTER TABLE public.movement_alerts ADD CONSTRAINT movement_alerts_kind_check CHECK (kind IN (
  'sos', 'man_overboard', 'zone_enter', 'zone_exit', 'silent', 'stopped', 'unexpected_stop', 'tracking_resumed',
  'checkin', 'checkin_missed', 'off_route', 'back_on_route', 'overdue',
  'voyage_started', 'voyage_completed', 'headcount_mismatch'
));
CREATE INDEX IF NOT EXISTS movement_alerts_voyage_idx ON public.movement_alerts(voyage_id) WHERE voyage_id IS NOT NULL;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.movement_voyages; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
