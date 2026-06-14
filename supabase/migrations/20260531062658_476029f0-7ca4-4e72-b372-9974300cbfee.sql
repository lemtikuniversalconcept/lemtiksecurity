-- =====================================================================
-- MULTI-TENANCY FOUNDATION
-- =====================================================================

-- 1. WIPE EXISTING DEMO DATA -------------------------------------------
TRUNCATE TABLE public.audit_log, public.alerts, public.incidents,
               public.patrols, public.user_roles, public.profiles
       RESTART IDENTITY CASCADE;

-- 2. DROP OLD POLICIES (will recreate after schema changes) -----------
DROP POLICY IF EXISTS "Alerts readable by authenticated" ON public.alerts;
DROP POLICY IF EXISTS "Managers delete alerts" ON public.alerts;
DROP POLICY IF EXISTS "Managers/supervisors create alerts" ON public.alerts;
DROP POLICY IF EXISTS "Managers/supervisors edit alerts" ON public.alerts;

DROP POLICY IF EXISTS "Audit readable by managers/supervisors" ON public.audit_log;

DROP POLICY IF EXISTS "Authenticated create incidents" ON public.incidents;
DROP POLICY IF EXISTS "Incidents readable by authenticated" ON public.incidents;
DROP POLICY IF EXISTS "Managers delete incidents" ON public.incidents;
DROP POLICY IF EXISTS "Managers/supervisors edit incidents" ON public.incidents;

DROP POLICY IF EXISTS "Managers delete patrols" ON public.patrols;
DROP POLICY IF EXISTS "Managers/supervisors create patrols" ON public.patrols;
DROP POLICY IF EXISTS "Managers/supervisors edit patrols" ON public.patrols;
DROP POLICY IF EXISTS "Patrols readable by authenticated" ON public.patrols;

DROP POLICY IF EXISTS "Profiles readable by authenticated" ON public.profiles;
DROP POLICY IF EXISTS "Users insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;

DROP POLICY IF EXISTS "Managers manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users and leadership can read roles" ON public.user_roles;

-- 3. NEW ENUMS ---------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.org_type AS ENUM ('estate','corporate','hotel','government');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.subscription_tier AS ENUM ('basic','professional','enterprise','government');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.subscription_status AS ENUM ('trial','active','past_due','suspended','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. ORGANISATIONS -----------------------------------------------------
CREATE TABLE public.organisations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type public.org_type NOT NULL DEFAULT 'corporate',
  address TEXT,
  coord_x NUMERIC,
  coord_y NUMERIC,
  logo_url TEXT,
  subscription_tier public.subscription_tier NOT NULL DEFAULT 'basic',
  subscription_status public.subscription_status NOT NULL DEFAULT 'trial',
  billing_contact_name TEXT,
  billing_contact_email TEXT,
  billing_contact_phone TEXT,
  brand_primary_color TEXT,
  brand_secondary_color TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organisations TO authenticated;
GRANT ALL ON public.organisations TO service_role;

-- 5. ORGANISATION MEMBERS ---------------------------------------------
CREATE TABLE public.organisation_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role public.app_role NOT NULL DEFAULT 'officer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organisation_id, user_id)
);
CREATE INDEX idx_org_members_user ON public.organisation_members(user_id);
CREATE INDEX idx_org_members_org ON public.organisation_members(organisation_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organisation_members TO authenticated;
GRANT ALL ON public.organisation_members TO service_role;

-- 6. ORGANISATION LOCATIONS -------------------------------------------
CREATE TABLE public.organisation_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  coord_x NUMERIC,
  coord_y NUMERIC,
  geofence JSONB,           -- GeoJSON-style polygon
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_org_locations_org ON public.organisation_locations(organisation_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organisation_locations TO authenticated;
GRANT ALL ON public.organisation_locations TO service_role;

-- 7. ORGANISATION EMERGENCY CONTACTS ----------------------------------
CREATE TABLE public.organisation_emergency_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  name TEXT,
  phone TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_org_emerg_org ON public.organisation_emergency_contacts(organisation_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organisation_emergency_contacts TO authenticated;
GRANT ALL ON public.organisation_emergency_contacts TO service_role;

-- 8. ORGANISATION SETTINGS --------------------------------------------
CREATE TABLE public.organisation_settings (
  organisation_id UUID PRIMARY KEY REFERENCES public.organisations(id) ON DELETE CASCADE,
  alert_escalation_contacts JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_incident_categories TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  report_delivery_schedule TEXT,
  whatsapp_alert_numbers TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  webhook_url TEXT,
  webhook_secret TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organisation_settings TO authenticated;
GRANT ALL ON public.organisation_settings TO service_role;

-- 9. EXTEND EXISTING TABLES -------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN active_organisation_id UUID REFERENCES public.organisations(id) ON DELETE SET NULL;

ALTER TABLE public.incidents
  ADD COLUMN organisation_id UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  ADD COLUMN location_id UUID REFERENCES public.organisation_locations(id) ON DELETE SET NULL;
CREATE INDEX idx_incidents_org ON public.incidents(organisation_id);

ALTER TABLE public.patrols
  ADD COLUMN organisation_id UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  ADD COLUMN location_id UUID REFERENCES public.organisation_locations(id) ON DELETE SET NULL;
CREATE INDEX idx_patrols_org ON public.patrols(organisation_id);

ALTER TABLE public.alerts
  ADD COLUMN organisation_id UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE;
CREATE INDEX idx_alerts_org ON public.alerts(organisation_id);

ALTER TABLE public.audit_log
  ADD COLUMN organisation_id UUID REFERENCES public.organisations(id) ON DELETE SET NULL;
CREATE INDEX idx_audit_org ON public.audit_log(organisation_id);

-- Allow lemtik_admin to live as a global role with NULL organisation
ALTER TABLE public.user_roles
  ADD COLUMN organisation_id UUID REFERENCES public.organisations(id) ON DELETE CASCADE;
-- Drop the old (user_id, role) unique to allow same role in multiple orgs
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_role_key;
CREATE UNIQUE INDEX user_roles_unique_per_org
  ON public.user_roles(user_id, role, COALESCE(organisation_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- 10. HELPER FUNCTIONS ------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_lemtik_admin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'lemtik_admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_org_member(_user_id UUID, _org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.is_lemtik_admin(_user_id) OR EXISTS (
    SELECT 1 FROM public.organisation_members
    WHERE user_id = _user_id AND organisation_id = _org_id
  );
$$;

CREATE OR REPLACE FUNCTION public.has_org_role(_user_id UUID, _org_id UUID, _roles public.app_role[])
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.is_lemtik_admin(_user_id) OR EXISTS (
    SELECT 1 FROM public.organisation_members
    WHERE user_id = _user_id AND organisation_id = _org_id AND role = ANY(_roles)
  );
$$;

CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT active_organisation_id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;
$$;

-- 11. ENABLE RLS ON NEW TABLES ----------------------------------------
ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_emergency_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_settings ENABLE ROW LEVEL SECURITY;

-- 12. POLICIES: ORGANISATIONS -----------------------------------------
CREATE POLICY "Members read their orgs" ON public.organisations
  FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), id));

CREATE POLICY "Authenticated can create orgs" ON public.organisations
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Admins update their org" ON public.organisations
  FOR UPDATE TO authenticated
  USING (public.has_org_role(auth.uid(), id, ARRAY['manager','client_admin']::public.app_role[]));

CREATE POLICY "Lemtik admin deletes orgs" ON public.organisations
  FOR DELETE TO authenticated
  USING (public.is_lemtik_admin(auth.uid()));

-- 13. POLICIES: ORG MEMBERS -------------------------------------------
CREATE POLICY "Members read same org members" ON public.organisation_members
  FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organisation_id));

CREATE POLICY "Admins add members" ON public.organisation_members
  FOR INSERT TO authenticated
  WITH CHECK (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','client_admin']::public.app_role[]));

CREATE POLICY "Admins update member roles" ON public.organisation_members
  FOR UPDATE TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','client_admin']::public.app_role[]));

CREATE POLICY "Admins remove members" ON public.organisation_members
  FOR DELETE TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','client_admin']::public.app_role[]));

-- Allow a brand-new org creator to seat themselves as the first client_admin.
-- Without this, the policy chain (no members yet → not an admin) blocks the seed insert.
CREATE POLICY "Org creator seeds self" ON public.organisation_members
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.organisations o
      WHERE o.id = organisation_id AND o.created_by = auth.uid()
    )
  );

-- 14. POLICIES: LOCATIONS --------------------------------------------
CREATE POLICY "Members read locations" ON public.organisation_locations
  FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organisation_id));

CREATE POLICY "Admins manage locations" ON public.organisation_locations
  FOR ALL TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','client_admin']::public.app_role[]))
  WITH CHECK (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','client_admin']::public.app_role[]));

-- 15. POLICIES: EMERGENCY CONTACTS -----------------------------------
CREATE POLICY "Members read emergency contacts" ON public.organisation_emergency_contacts
  FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organisation_id));

CREATE POLICY "Admins manage emergency contacts" ON public.organisation_emergency_contacts
  FOR ALL TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','client_admin']::public.app_role[]))
  WITH CHECK (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','client_admin']::public.app_role[]));

-- 16. POLICIES: SETTINGS ---------------------------------------------
CREATE POLICY "Members read settings" ON public.organisation_settings
  FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organisation_id));

CREATE POLICY "Admins manage settings" ON public.organisation_settings
  FOR ALL TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','client_admin']::public.app_role[]))
  WITH CHECK (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','client_admin']::public.app_role[]));

-- 17. POLICIES: PROFILES ---------------------------------------------
CREATE POLICY "Authenticated read profiles in their orgs" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_lemtik_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.organisation_members m1
      JOIN public.organisation_members m2
        ON m1.organisation_id = m2.organisation_id
      WHERE m1.user_id = auth.uid() AND m2.user_id = public.profiles.user_id
    )
  );

CREATE POLICY "Users insert own profile" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- 18. POLICIES: USER_ROLES (legacy global role table, kept for lemtik_admin) ---
CREATE POLICY "Self read roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_lemtik_admin(auth.uid()));

CREATE POLICY "Lemtik admin manages roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.is_lemtik_admin(auth.uid()))
  WITH CHECK (public.is_lemtik_admin(auth.uid()));

-- 19. POLICIES: INCIDENTS --------------------------------------------
CREATE POLICY "Members read org incidents" ON public.incidents
  FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organisation_id));

CREATE POLICY "Members create org incidents" ON public.incidents
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = reported_by
    AND public.is_org_member(auth.uid(), organisation_id)
  );

CREATE POLICY "Leadership updates org incidents" ON public.incidents
  FOR UPDATE TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin']::public.app_role[]));

CREATE POLICY "Admins delete org incidents" ON public.incidents
  FOR DELETE TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','client_admin']::public.app_role[]));

-- 20. POLICIES: PATROLS ----------------------------------------------
CREATE POLICY "Members read org patrols" ON public.patrols
  FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organisation_id));

CREATE POLICY "Leadership creates org patrols" ON public.patrols
  FOR INSERT TO authenticated
  WITH CHECK (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin']::public.app_role[]));

CREATE POLICY "Leadership updates org patrols" ON public.patrols
  FOR UPDATE TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin']::public.app_role[]));

CREATE POLICY "Admins delete org patrols" ON public.patrols
  FOR DELETE TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','client_admin']::public.app_role[]));

-- 21. POLICIES: ALERTS -----------------------------------------------
CREATE POLICY "Members read org alerts" ON public.alerts
  FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organisation_id));

CREATE POLICY "Leadership creates org alerts" ON public.alerts
  FOR INSERT TO authenticated
  WITH CHECK (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin']::public.app_role[]));

CREATE POLICY "Leadership updates org alerts" ON public.alerts
  FOR UPDATE TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin']::public.app_role[]));

CREATE POLICY "Admins delete org alerts" ON public.alerts
  FOR DELETE TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','client_admin']::public.app_role[]));

-- 22. POLICIES: AUDIT LOG --------------------------------------------
CREATE POLICY "Leadership reads org audit" ON public.audit_log
  FOR SELECT TO authenticated
  USING (
    organisation_id IS NOT NULL
    AND public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin']::public.app_role[])
  );

-- 23. TRIGGERS for updated_at ----------------------------------------
CREATE TRIGGER trg_orgs_updated_at BEFORE UPDATE ON public.organisations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_org_locations_updated_at BEFORE UPDATE ON public.organisation_locations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_org_settings_updated_at BEFORE UPDATE ON public.organisation_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 24. UPDATE handle_new_user: profile only, no auto-role -------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email,'@',1)));
  RETURN NEW;
END; $$;

-- 25. STORAGE BUCKET for org logos -----------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('org-logos', 'org-logos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read org logos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'org-logos');

CREATE POLICY "Org admins upload logos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'org-logos'
    AND public.has_org_role(
      auth.uid(),
      ((storage.foldername(name))[1])::uuid,
      ARRAY['manager','client_admin']::public.app_role[]
    )
  );

CREATE POLICY "Org admins update logos"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'org-logos'
    AND public.has_org_role(
      auth.uid(),
      ((storage.foldername(name))[1])::uuid,
      ARRAY['manager','client_admin']::public.app_role[]
    )
  );

CREATE POLICY "Org admins delete logos"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'org-logos'
    AND public.has_org_role(
      auth.uid(),
      ((storage.foldername(name))[1])::uuid,
      ARRAY['manager','client_admin']::public.app_role[]
    )
  );