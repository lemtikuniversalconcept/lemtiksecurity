-- ============================================================
-- Corridor Watch: approved waterway corridors with curfew and weather
-- limits, jetty boarding checks (capacity, life jackets, passenger list by
-- QR), and hand-off of an emergency to the nearest responder.
-- ============================================================

-- Boats: how many people they may carry and how many life jackets they hold.
ALTER TABLE public.movement_subjects
  ADD COLUMN IF NOT EXISTS passenger_capacity integer CHECK (passenger_capacity BETWEEN 1 AND 5000),
  ADD COLUMN IF NOT EXISTS life_jackets integer CHECK (life_jackets BETWEEN 0 AND 5000);

-- ---------- Approved corridors ----------
CREATE TABLE IF NOT EXISTS public.movement_corridors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  route jsonb NOT NULL DEFAULT '[]'::jsonb,
  corridor_m integer NOT NULL DEFAULT 1000 CHECK (corridor_m BETWEEN 100 AND 50000),
  curfew_start time,          -- local time (Africa/Lagos); no movement allowed from here…
  curfew_end time,            -- …until here (may wrap past midnight)
  max_wind_kn integer CHECK (max_wind_kn BETWEEN 5 AND 80),
  active boolean NOT NULL DEFAULT true,
  notes text CHECK (char_length(notes) <= 2000),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS movement_corridors_org_idx ON public.movement_corridors (organisation_id);
ALTER TABLE public.movement_corridors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "movement_corridors_read" ON public.movement_corridors;
CREATE POLICY "movement_corridors_read" ON public.movement_corridors FOR SELECT TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin']::public.app_role[]));
DROP POLICY IF EXISTS "movement_corridors_write" ON public.movement_corridors;
CREATE POLICY "movement_corridors_write" ON public.movement_corridors FOR ALL TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager']::public.app_role[]))
  WITH CHECK (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager']::public.app_role[]));

-- ---------- Voyages: corridor, boarding check, passenger QR ----------
ALTER TABLE public.movement_voyages
  ADD COLUMN IF NOT EXISTS corridor_id uuid REFERENCES public.movement_corridors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS boarding_token text UNIQUE,
  ADD COLUMN IF NOT EXISTS boarding jsonb,
  ADD COLUMN IF NOT EXISTS curfew_alerted boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.voyage_passengers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  voyage_id uuid NOT NULL REFERENCES public.movement_voyages(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  phone text CHECK (char_length(phone) <= 40),
  next_of_kin_phone text CHECK (char_length(next_of_kin_phone) <= 40),
  source text NOT NULL DEFAULT 'qr' CHECK (source IN ('qr', 'staff')),
  boarded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS voyage_passengers_voyage_idx ON public.voyage_passengers (voyage_id, boarded_at);
ALTER TABLE public.voyage_passengers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "voyage_passengers_read" ON public.voyage_passengers;
CREATE POLICY "voyage_passengers_read" ON public.voyage_passengers FOR SELECT TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin']::public.app_role[]));
DROP POLICY IF EXISTS "voyage_passengers_write" ON public.voyage_passengers;
CREATE POLICY "voyage_passengers_write" ON public.voyage_passengers FOR ALL TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor']::public.app_role[]))
  WITH CHECK (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor']::public.app_role[]));
-- Passengers who scan the jetty QR are added by the server after it checks the voyage's boarding token.

-- ---------- Responders and hand-offs ----------
CREATE TABLE IF NOT EXISTS public.movement_responders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  kind text NOT NULL CHECK (kind IN ('marine_police', 'navy', 'search_rescue', 'waterways_authority', 'medical', 'private_security', 'other')),
  phone text CHECK (char_length(phone) <= 40),
  whatsapp text CHECK (char_length(whatsapp) <= 40),
  lat double precision CHECK (lat BETWEEN -90 AND 90),
  lng double precision CHECK (lng BETWEEN -180 AND 180),
  notes text CHECK (char_length(notes) <= 1000),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS movement_responders_org_idx ON public.movement_responders (organisation_id);
ALTER TABLE public.movement_responders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "movement_responders_read" ON public.movement_responders;
CREATE POLICY "movement_responders_read" ON public.movement_responders FOR SELECT TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin']::public.app_role[]));
DROP POLICY IF EXISTS "movement_responders_write" ON public.movement_responders;
CREATE POLICY "movement_responders_write" ON public.movement_responders FOR ALL TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager']::public.app_role[]))
  WITH CHECK (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager']::public.app_role[]));

CREATE TABLE IF NOT EXISTS public.movement_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  voyage_id uuid REFERENCES public.movement_voyages(id) ON DELETE SET NULL,
  subject_id uuid REFERENCES public.movement_subjects(id) ON DELETE SET NULL,
  responder_id uuid REFERENCES public.movement_responders(id) ON DELETE SET NULL,
  responder_name text NOT NULL,
  distance_m integer,
  channel text NOT NULL CHECK (channel IN ('call', 'whatsapp')),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 10 AND 4000),
  approved_by uuid NOT NULL,
  approved_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS movement_handoffs_voyage_idx ON public.movement_handoffs (voyage_id, created_at);
ALTER TABLE public.movement_handoffs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "movement_handoffs_read" ON public.movement_handoffs;
CREATE POLICY "movement_handoffs_read" ON public.movement_handoffs FOR SELECT TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin']::public.app_role[]));
DROP POLICY IF EXISTS "movement_handoffs_insert" ON public.movement_handoffs;
CREATE POLICY "movement_handoffs_insert" ON public.movement_handoffs FOR INSERT TO authenticated
  WITH CHECK (approved_by = auth.uid() AND public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor']::public.app_role[]));

-- ---------- New alert kinds ----------
ALTER TABLE public.movement_alerts DROP CONSTRAINT IF EXISTS movement_alerts_kind_check;
ALTER TABLE public.movement_alerts ADD CONSTRAINT movement_alerts_kind_check CHECK (kind IN (
  'sos', 'man_overboard', 'zone_enter', 'zone_exit', 'silent', 'stopped', 'unexpected_stop', 'tracking_resumed',
  'checkin', 'checkin_missed', 'off_route', 'back_on_route', 'overdue', 'voyage_started', 'voyage_completed',
  'headcount_mismatch', 'curfew', 'boarding_override', 'handoff'
));
