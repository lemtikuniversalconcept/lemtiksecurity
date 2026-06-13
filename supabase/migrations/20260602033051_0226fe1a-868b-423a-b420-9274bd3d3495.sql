
-- =========== Feature 4: Incident Reporting — schema expansion ===========

-- Expand incident types
ALTER TYPE public.incident_type ADD VALUE IF NOT EXISTS 'robbery';
ALTER TYPE public.incident_type ADD VALUE IF NOT EXISTS 'armed_attack';
ALTER TYPE public.incident_type ADD VALUE IF NOT EXISTS 'kidnapping';
ALTER TYPE public.incident_type ADD VALUE IF NOT EXISTS 'vandalism';
ALTER TYPE public.incident_type ADD VALUE IF NOT EXISTS 'fraud_scam';
ALTER TYPE public.incident_type ADD VALUE IF NOT EXISTS 'cyber_incident';

-- Expand the incidents table for richer reporting
ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS occurred_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS suspect_count smallint,
  ADD COLUMN IF NOT EXISTS suspect_description text,
  ADD COLUMN IF NOT EXISTS victim_name text,
  ADD COLUMN IF NOT EXISTS victim_contact text,
  ADD COLUMN IF NOT EXISTS witnesses text,
  ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS linked_incident_id uuid,
  ADD COLUMN IF NOT EXISTS client_visible boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS quick_report boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_incidents_org_reported ON public.incidents (organisation_id, reported_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_linked ON public.incidents (linked_incident_id);

-- =========== Private storage bucket for evidence ===========
INSERT INTO storage.buckets (id, name, public)
VALUES ('incident-evidence', 'incident-evidence', false)
ON CONFLICT (id) DO NOTHING;

-- Path convention: <organisation_id>/<incident_id>/<filename>
-- Members of the org can read; members of the org can upload (their org folder).
DROP POLICY IF EXISTS "Members read evidence" ON storage.objects;
CREATE POLICY "Members read evidence"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'incident-evidence'
    AND public.is_org_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "Members upload evidence" ON storage.objects;
CREATE POLICY "Members upload evidence"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'incident-evidence'
    AND public.is_org_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "Admins delete evidence" ON storage.objects;
CREATE POLICY "Admins delete evidence"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'incident-evidence'
    AND public.has_org_role(auth.uid(), ((storage.foldername(name))[1])::uuid,
                            ARRAY['manager'::app_role, 'client_admin'::app_role])
  );

-- =========== Bug fix: ensure profile row exists for OAuth users ===========
-- Some users created via the OAuth broker may not have a profiles row
-- (no trigger on auth.users). Backfill any missing profiles now so the
-- onboarding -> /app handoff works.
INSERT INTO public.profiles (user_id, display_name)
SELECT u.id, COALESCE(u.raw_user_meta_data->>'display_name',
                      split_part(u.email, '@', 1), '')
FROM auth.users u
LEFT JOIN public.profiles p ON p.user_id = u.id
WHERE p.user_id IS NULL;
