-- Drill evidence and training records for ISPS Watch.
--
--   isps_drills    + lessons_learned, attendance (who took part), evidence (photos and documents,
--                    each fingerprinted with SHA-256 when attached)
--   isps_training  training and certificates held by security staff, with expiry dates
--   isps-evidence  private storage bucket, read and written only through short-lived signed links

ALTER TABLE public.isps_drills
  ADD COLUMN IF NOT EXISTS lessons_learned text CHECK (char_length(lessons_learned) <= 4000),
  ADD COLUMN IF NOT EXISTS attendance jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS evidence_updated_at timestamptz;

CREATE TABLE IF NOT EXISTS public.isps_training (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  facility_id uuid REFERENCES public.isps_facilities(id) ON DELETE SET NULL,
  person_name text NOT NULL CHECK (char_length(person_name) BETWEEN 2 AND 160),
  person_role text NOT NULL CHECK (char_length(person_role) BETWEEN 2 AND 120),
  course text NOT NULL CHECK (char_length(course) BETWEEN 2 AND 200),
  provider text CHECK (char_length(provider) <= 200),
  certificate_no text CHECK (char_length(certificate_no) <= 120),
  completed_on date NOT NULL,
  expires_on date CHECK (expires_on IS NULL OR expires_on >= completed_on),
  notes text CHECK (char_length(notes) <= 2000),
  certificate jsonb,
  recorded_by uuid,
  recorded_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  archived_by_name text
);
CREATE INDEX IF NOT EXISTS isps_training_org_idx ON public.isps_training (organisation_id, expires_on);
ALTER TABLE public.isps_training ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "isps_training_read" ON public.isps_training;
CREATE POLICY "isps_training_read" ON public.isps_training FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organisation_id));
-- Written by the server only.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('isps-evidence', 'isps-evidence', false, 26214400, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Breaches linked to incidents: the column existed without a foreign key.
UPDATE public.isps_breaches b SET incident_id = NULL
  WHERE incident_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.incidents i WHERE i.id = b.incident_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'isps_breaches_incident_id_fkey') THEN
    ALTER TABLE public.isps_breaches ADD CONSTRAINT isps_breaches_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS isps_breaches_incident_idx ON public.isps_breaches (incident_id) WHERE incident_id IS NOT NULL;
