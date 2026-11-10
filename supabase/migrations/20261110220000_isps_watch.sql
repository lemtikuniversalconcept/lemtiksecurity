-- ============================================================
-- ISPS Watch: the records a port facility (or ship) keeps under the ISPS Code,
-- and formal notices from an authority with read receipts.
--
--   isps_facilities         port facilities, terminals, jetties, ships; current security level
--   isps_level_changes      every security level change, who made it and why (insert-only)
--   isps_drills             drills and exercises with findings and corrective actions
--   isps_declarations       Declarations of Security; the ship side signs through a link
--   isps_breaches           security incidents and breaches, and whether the authority was told
--   authority_notices       directives, advisories and security level instructions
--   authority_notice_recipients   per organisation: delivered, opened, acknowledged
--
-- Authorities see another organisation's ISPS records only through an active
-- shared-access link with the "isps" scope, read by the server.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.isps_facilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  kind text NOT NULL DEFAULT 'port_facility' CHECK (kind IN ('port_facility', 'terminal', 'jetty', 'offshore', 'ship')),
  identifier text CHECK (char_length(identifier) <= 60), -- IMO GISIS facility number or ship IMO number
  security_level smallint NOT NULL DEFAULT 1 CHECK (security_level BETWEEN 1 AND 3),
  level_set_at timestamptz NOT NULL DEFAULT now(),
  level_set_by_name text,
  level_reason text CHECK (char_length(level_reason) <= 500),
  security_officer_name text CHECK (char_length(security_officer_name) <= 120),
  security_officer_phone text CHECK (char_length(security_officer_phone) <= 40),
  plan_approved_on date,
  plan_expires_on date,
  notes text CHECK (char_length(notes) <= 2000),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS isps_facilities_org_idx ON public.isps_facilities (organisation_id);
ALTER TABLE public.isps_facilities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "isps_facilities_read" ON public.isps_facilities;
CREATE POLICY "isps_facilities_read" ON public.isps_facilities FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organisation_id));
DROP POLICY IF EXISTS "isps_facilities_write" ON public.isps_facilities;
CREATE POLICY "isps_facilities_write" ON public.isps_facilities FOR ALL TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager']::public.app_role[]))
  WITH CHECK (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager']::public.app_role[]));

CREATE TABLE IF NOT EXISTS public.isps_level_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES public.isps_facilities(id) ON DELETE CASCADE,
  from_level smallint NOT NULL,
  to_level smallint NOT NULL CHECK (to_level BETWEEN 1 AND 3),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500),
  notice_id uuid,
  changed_by uuid,
  changed_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS isps_level_changes_fac_idx ON public.isps_level_changes (facility_id, created_at DESC);
ALTER TABLE public.isps_level_changes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "isps_level_changes_read" ON public.isps_level_changes;
CREATE POLICY "isps_level_changes_read" ON public.isps_level_changes FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organisation_id));
-- Written by the server only; never edited.

CREATE TABLE IF NOT EXISTS public.isps_drills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES public.isps_facilities(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('drill', 'exercise')),
  scenario text NOT NULL CHECK (char_length(scenario) BETWEEN 3 AND 300),
  held_on date NOT NULL,
  participants integer CHECK (participants BETWEEN 0 AND 10000),
  findings text CHECK (char_length(findings) <= 4000),
  corrective_actions text CHECK (char_length(corrective_actions) <= 4000),
  recorded_by uuid,
  recorded_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS isps_drills_fac_idx ON public.isps_drills (facility_id, held_on DESC);
ALTER TABLE public.isps_drills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "isps_drills_read" ON public.isps_drills;
CREATE POLICY "isps_drills_read" ON public.isps_drills FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organisation_id));
DROP POLICY IF EXISTS "isps_drills_insert" ON public.isps_drills;
CREATE POLICY "isps_drills_insert" ON public.isps_drills FOR INSERT TO authenticated
  WITH CHECK (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor']::public.app_role[]));

CREATE TABLE IF NOT EXISTS public.isps_declarations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES public.isps_facilities(id) ON DELETE CASCADE,
  reference text NOT NULL,
  ship_name text NOT NULL CHECK (char_length(ship_name) BETWEEN 1 AND 160),
  ship_imo text CHECK (char_length(ship_imo) <= 20),
  ship_flag text CHECK (char_length(ship_flag) <= 60),
  security_level smallint NOT NULL CHECK (security_level BETWEEN 1 AND 3),
  activities text NOT NULL CHECK (char_length(activities) BETWEEN 3 AND 1000),
  measures text NOT NULL CHECK (char_length(measures) BETWEEN 3 AND 4000),
  valid_from timestamptz NOT NULL,
  valid_to timestamptz NOT NULL CHECK (valid_to > valid_from),
  port_signatory_name text NOT NULL,
  port_signatory_title text NOT NULL,
  port_signed_by uuid NOT NULL,
  port_signed_at timestamptz NOT NULL DEFAULT now(),
  sign_token text UNIQUE,
  ship_signatory_name text,
  ship_signatory_title text,
  ship_signed_at timestamptz,
  content_sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'awaiting_ship' CHECK (status IN ('awaiting_ship', 'signed', 'cancelled')),
  cancelled_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS isps_declarations_org_idx ON public.isps_declarations (organisation_id, created_at DESC);
ALTER TABLE public.isps_declarations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "isps_declarations_read" ON public.isps_declarations;
CREATE POLICY "isps_declarations_read" ON public.isps_declarations FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organisation_id));
-- Written by the server only, so a signed declaration can't be altered.

CREATE TABLE IF NOT EXISTS public.isps_breaches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES public.isps_facilities(id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL,
  category text NOT NULL CHECK (category IN ('unauthorised_access', 'stowaway', 'theft', 'tampering', 'suspicious_activity', 'armed_attack', 'smuggling', 'cyber', 'other')),
  description text NOT NULL CHECK (char_length(description) BETWEEN 3 AND 4000),
  action_taken text CHECK (char_length(action_taken) <= 4000),
  security_level smallint CHECK (security_level BETWEEN 1 AND 3),
  incident_id uuid,
  reported_to_authority boolean NOT NULL DEFAULT false,
  reported_at timestamptz,
  reported_to text CHECK (char_length(reported_to) <= 200),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at timestamptz,
  recorded_by uuid,
  recorded_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS isps_breaches_org_idx ON public.isps_breaches (organisation_id, occurred_at DESC);
ALTER TABLE public.isps_breaches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "isps_breaches_read" ON public.isps_breaches;
CREATE POLICY "isps_breaches_read" ON public.isps_breaches FOR SELECT TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin','security_forensic_analyst']::public.app_role[]));
DROP POLICY IF EXISTS "isps_breaches_insert" ON public.isps_breaches;
CREATE POLICY "isps_breaches_insert" ON public.isps_breaches FOR INSERT TO authenticated
  WITH CHECK (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor']::public.app_role[]));
DROP POLICY IF EXISTS "isps_breaches_update" ON public.isps_breaches;
CREATE POLICY "isps_breaches_update" ON public.isps_breaches FOR UPDATE TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor']::public.app_role[]))
  WITH CHECK (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor']::public.app_role[]));

CREATE TABLE IF NOT EXISTS public.authority_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_org_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  reference text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('directive', 'advisory', 'security_level')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 200),
  body text NOT NULL CHECK (char_length(body) BETWEEN 3 AND 8000),
  required_level smallint CHECK (required_level BETWEEN 1 AND 3),
  respond_by timestamptz,
  issued_by uuid NOT NULL,
  issued_by_name text,
  issued_at timestamptz NOT NULL DEFAULT now(),
  body_sha256 text NOT NULL
);
CREATE INDEX IF NOT EXISTS authority_notices_from_idx ON public.authority_notices (from_org_id, issued_at DESC);
ALTER TABLE public.authority_notices ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.authority_notice_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_id uuid NOT NULL REFERENCES public.authority_notices(id) ON DELETE CASCADE,
  from_org_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  delivered_at timestamptz NOT NULL DEFAULT now(),
  first_read_at timestamptz,
  first_read_by_name text,
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  acknowledged_by_name text,
  response text CHECK (char_length(response) <= 4000),
  UNIQUE (notice_id, org_id)
);
CREATE INDEX IF NOT EXISTS authority_notice_recipients_org_idx ON public.authority_notice_recipients (org_id, delivered_at DESC);
ALTER TABLE public.authority_notice_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authority_notices_read" ON public.authority_notices;
CREATE POLICY "authority_notices_read" ON public.authority_notices FOR SELECT TO authenticated
  USING (
    public.is_org_member(auth.uid(), from_org_id)
    OR EXISTS (SELECT 1 FROM public.authority_notice_recipients r WHERE r.notice_id = authority_notices.id AND public.is_org_member(auth.uid(), r.org_id))
  );
DROP POLICY IF EXISTS "authority_notice_recipients_read" ON public.authority_notice_recipients;
CREATE POLICY "authority_notice_recipients_read" ON public.authority_notice_recipients FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), from_org_id) OR public.is_org_member(auth.uid(), org_id));
-- Notices and receipts are written by the server only.
