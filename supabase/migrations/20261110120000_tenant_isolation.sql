-- ============================================================
-- Tenant isolation and role separation.
--
-- 1. Lemtik staff no longer pass every organisation's role checks.
--    has_org_role() and is_org_member() used to start with
--    "is_lemtik_admin(user) OR …", which let a Lemtik admin read and
--    change any client's operational data (incidents, officers,
--    cameras, forensic cases, movement). Lemtik keeps only its explicit
--    platform policies: organisations, members, invites, settings,
--    locations, billing, platform health and the audit log.
--
-- 2. Protected movement follows the role spec:
--      Security Manager (manager)  — people, boats, consent, tracking, zones
--      Operator (supervisor)       — voyages, head counts, acknowledging alerts
--      Client Admin                — read-only on operations
-- ============================================================

CREATE OR REPLACE FUNCTION public.has_org_role(_user_id uuid, _org_id uuid, _roles app_role[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organisation_members
    WHERE user_id = _user_id AND organisation_id = _org_id AND role = ANY(_roles)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_org_member(_user_id uuid, _org_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organisation_members
    WHERE user_id = _user_id AND organisation_id = _org_id
  );
$$;

-- Incidents are client operational data.
DROP POLICY IF EXISTS "Lemtik admin reads incidents" ON public.incidents;

-- ---------- Protected movement: role separation ----------
DROP POLICY IF EXISTS "movement_subjects_insert" ON public.movement_subjects;
CREATE POLICY "movement_subjects_insert" ON public.movement_subjects FOR INSERT TO authenticated
  WITH CHECK (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager']::public.app_role[]));
DROP POLICY IF EXISTS "movement_subjects_update" ON public.movement_subjects;
CREATE POLICY "movement_subjects_update" ON public.movement_subjects FOR UPDATE TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager']::public.app_role[]))
  WITH CHECK (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager']::public.app_role[]));
DROP POLICY IF EXISTS "movement_subjects_delete" ON public.movement_subjects;
CREATE POLICY "movement_subjects_delete" ON public.movement_subjects FOR DELETE TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager']::public.app_role[]));

DROP POLICY IF EXISTS "movement_geofences_write" ON public.movement_geofences;
CREATE POLICY "movement_geofences_write" ON public.movement_geofences FOR ALL TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager']::public.app_role[]))
  WITH CHECK (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager']::public.app_role[]));

DROP POLICY IF EXISTS "movement_voyages_write" ON public.movement_voyages;
CREATE POLICY "movement_voyages_write" ON public.movement_voyages FOR ALL TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor']::public.app_role[]))
  WITH CHECK (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor']::public.app_role[]));

DROP POLICY IF EXISTS "movement_alerts_ack" ON public.movement_alerts;
CREATE POLICY "movement_alerts_ack" ON public.movement_alerts FOR UPDATE TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor']::public.app_role[]))
  WITH CHECK (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor']::public.app_role[]));
