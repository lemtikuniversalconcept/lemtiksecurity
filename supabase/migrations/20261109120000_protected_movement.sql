-- ============================================================
-- Protected Movement: people, vehicles and vessels tracked on the move
-- (students for an institution, a principal for an executive-protection
-- team, a client's own patrol/crew/escort boats).
--
-- Privacy by design (Nigeria Data Protection Act 2023):
--   * tracking stays OFF until consent is recorded on the subject;
--   * only an org's managers, supervisors and client admins can read
--     positions — officers and consumers cannot;
--   * positions are written only by the server (tracker ingest uses a
--     per-subject secret), never directly by a browser.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.movement_subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('person', 'vehicle', 'vessel')),
  category TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('student', 'principal', 'staff', 'vehicle', 'patrol_boat', 'crew_boat', 'escort_vessel', 'supply_vessel', 'other')),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  reference TEXT,                         -- student ID, plate number, vessel name/IMO
  mmsi TEXT,                              -- vessels: 9-digit AIS identity, optional
  phone TEXT,
  emergency_contact TEXT,                 -- guardian / next of kin / ops desk
  notes TEXT,

  consent_status TEXT NOT NULL DEFAULT 'pending' CHECK (consent_status IN ('pending', 'granted', 'withdrawn')),
  consent_recorded_at TIMESTAMPTZ,
  consent_recorded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  consent_note TEXT,                      -- how consent was given (signed form, app, parent for a minor…)
  tracking_enabled BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT tracking_needs_consent CHECK (NOT tracking_enabled OR consent_status = 'granted'),

  device_kind TEXT NOT NULL DEFAULT 'phone' CHECK (device_kind IN ('phone', 'gps_tracker', 'satellite_tracker')),
  device_id TEXT,                         -- tracker IMEI / unique id, for hardware trackers
  tracker_token TEXT NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  silent_after_minutes INTEGER NOT NULL DEFAULT 15 CHECK (silent_after_minutes BETWEEN 1 AND 1440),

  last_lat DOUBLE PRECISION,
  last_lng DOUBLE PRECISION,
  last_speed_mps DOUBLE PRECISION,
  last_heading DOUBLE PRECISION,
  last_battery SMALLINT,
  last_seen_at TIMESTAMPTZ,
  inside_geofence_ids UUID[] NOT NULL DEFAULT '{}',
  state TEXT NOT NULL DEFAULT 'idle' CHECK (state IN ('idle', 'moving', 'stopped', 'silent', 'sos')),

  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS movement_subjects_tracker_token_key ON public.movement_subjects(tracker_token);
CREATE UNIQUE INDEX IF NOT EXISTS movement_subjects_device_key ON public.movement_subjects(device_id) WHERE device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS movement_subjects_org_idx ON public.movement_subjects(organisation_id);

CREATE TABLE IF NOT EXISTS public.movement_positions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisation_id UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES public.movement_subjects(id) ON DELETE CASCADE,
  lat DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  accuracy_m DOUBLE PRECISION,
  speed_mps DOUBLE PRECISION,
  heading DOUBLE PRECISION,
  battery SMALLINT,
  source TEXT NOT NULL DEFAULT 'phone' CHECK (source IN ('phone', 'device', 'satellite', 'manual')),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS movement_positions_subject_time_idx ON public.movement_positions(subject_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS movement_positions_org_time_idx ON public.movement_positions(organisation_id, recorded_at DESC);

-- Circular zones: a campus or home (safe), a no-go area (restricted), or an
-- exclusion zone around a platform, jetty or anchorage (maritime).
CREATE TABLE IF NOT EXISTS public.movement_geofences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  kind TEXT NOT NULL DEFAULT 'safe' CHECK (kind IN ('safe', 'restricted', 'exclusion')),
  center_lat DOUBLE PRECISION NOT NULL CHECK (center_lat BETWEEN -90 AND 90),
  center_lng DOUBLE PRECISION NOT NULL CHECK (center_lng BETWEEN -180 AND 180),
  radius_m INTEGER NOT NULL CHECK (radius_m BETWEEN 20 AND 100000),
  alert_on TEXT NOT NULL DEFAULT 'both' CHECK (alert_on IN ('enter', 'exit', 'both')),
  subject_ids UUID[],                     -- NULL = applies to every subject in the org
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS movement_geofences_org_idx ON public.movement_geofences(organisation_id) WHERE active;

CREATE TABLE IF NOT EXISTS public.movement_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES public.movement_subjects(id) ON DELETE CASCADE,
  geofence_id UUID REFERENCES public.movement_geofences(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('sos', 'zone_enter', 'zone_exit', 'silent', 'stopped', 'tracking_resumed')),
  severity SMALLINT NOT NULL DEFAULT 2 CHECK (severity BETWEEN 1 AND 5),
  message TEXT NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  incident_id UUID REFERENCES public.incidents(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS movement_alerts_org_time_idx ON public.movement_alerts(organisation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS movement_alerts_open_idx ON public.movement_alerts(organisation_id) WHERE acknowledged_at IS NULL;

-- updated_at
DROP TRIGGER IF EXISTS movement_subjects_updated_at ON public.movement_subjects;
CREATE TRIGGER movement_subjects_updated_at BEFORE UPDATE ON public.movement_subjects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS movement_geofences_updated_at ON public.movement_geofences;
CREATE TRIGGER movement_geofences_updated_at BEFORE UPDATE ON public.movement_geofences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- Row-level security ----------
ALTER TABLE public.movement_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movement_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movement_geofences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movement_alerts ENABLE ROW LEVEL SECURITY;

-- Subjects: leadership reads; managers and client admins manage.
DROP POLICY IF EXISTS "movement_subjects_read" ON public.movement_subjects;
CREATE POLICY "movement_subjects_read" ON public.movement_subjects FOR SELECT TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin']::public.app_role[]));
DROP POLICY IF EXISTS "movement_subjects_insert" ON public.movement_subjects;
CREATE POLICY "movement_subjects_insert" ON public.movement_subjects FOR INSERT TO authenticated
  WITH CHECK (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','client_admin']::public.app_role[]));
DROP POLICY IF EXISTS "movement_subjects_update" ON public.movement_subjects;
CREATE POLICY "movement_subjects_update" ON public.movement_subjects FOR UPDATE TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','client_admin']::public.app_role[]))
  WITH CHECK (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','client_admin']::public.app_role[]));
DROP POLICY IF EXISTS "movement_subjects_delete" ON public.movement_subjects;
CREATE POLICY "movement_subjects_delete" ON public.movement_subjects FOR DELETE TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','client_admin']::public.app_role[]));

-- Positions: leadership reads; only the server (service role) writes.
DROP POLICY IF EXISTS "movement_positions_read" ON public.movement_positions;
CREATE POLICY "movement_positions_read" ON public.movement_positions FOR SELECT TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin']::public.app_role[]));

-- Geofences: leadership reads and manages.
DROP POLICY IF EXISTS "movement_geofences_read" ON public.movement_geofences;
CREATE POLICY "movement_geofences_read" ON public.movement_geofences FOR SELECT TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin']::public.app_role[]));
DROP POLICY IF EXISTS "movement_geofences_write" ON public.movement_geofences;
CREATE POLICY "movement_geofences_write" ON public.movement_geofences FOR ALL TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin']::public.app_role[]))
  WITH CHECK (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin']::public.app_role[]));

-- Alerts: leadership reads and acknowledges; the server creates them.
DROP POLICY IF EXISTS "movement_alerts_read" ON public.movement_alerts;
CREATE POLICY "movement_alerts_read" ON public.movement_alerts FOR SELECT TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin']::public.app_role[]));
DROP POLICY IF EXISTS "movement_alerts_ack" ON public.movement_alerts;
CREATE POLICY "movement_alerts_ack" ON public.movement_alerts FOR UPDATE TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin']::public.app_role[]))
  WITH CHECK (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin']::public.app_role[]));

-- Live updates for the command map (RLS still applies to realtime).
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.movement_subjects; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.movement_alerts; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- Data minimisation: drop raw position history after 90 days.
CREATE OR REPLACE FUNCTION public.purge_old_movement_positions()
RETURNS INTEGER LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH d AS (DELETE FROM public.movement_positions WHERE recorded_at < now() - interval '90 days' RETURNING 1)
  SELECT count(*)::int FROM d;
$$;
REVOKE ALL ON FUNCTION public.purge_old_movement_positions() FROM PUBLIC, anon, authenticated;
