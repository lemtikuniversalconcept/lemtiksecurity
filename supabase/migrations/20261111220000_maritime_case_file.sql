-- ============================================================
-- M4: maritime case file.
--   movement_checkins   every "all OK" check-in, so a case file can list them
--   voyage_records      written statements and media attached to a voyage,
--                       fingerprinted (SHA-256) when they are added
-- Both are written by the server only.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.movement_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES public.movement_subjects(id) ON DELETE CASCADE,
  voyage_id uuid REFERENCES public.movement_voyages(id) ON DELETE SET NULL,
  lat double precision,
  lng double precision,
  was_overdue boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS movement_checkins_voyage_idx ON public.movement_checkins (voyage_id, created_at);
CREATE INDEX IF NOT EXISTS movement_checkins_subject_idx ON public.movement_checkins (subject_id, created_at DESC);
ALTER TABLE public.movement_checkins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "movement_checkins_read" ON public.movement_checkins;
CREATE POLICY "movement_checkins_read" ON public.movement_checkins FOR SELECT TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin']::public.app_role[]));

CREATE TABLE IF NOT EXISTS public.voyage_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  voyage_id uuid NOT NULL REFERENCES public.movement_voyages(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('statement', 'media')),
  -- statement
  given_by_name text CHECK (given_by_name IS NULL OR char_length(given_by_name) BETWEEN 1 AND 120),
  given_by_role text CHECK (given_by_role IS NULL OR char_length(given_by_role) <= 80),
  given_by_contact text CHECK (given_by_contact IS NULL OR char_length(given_by_contact) <= 120),
  statement text CHECK (statement IS NULL OR char_length(statement) BETWEEN 10 AND 20000),
  -- media
  path text CHECK (path IS NULL OR char_length(path) <= 300),
  file_name text CHECK (file_name IS NULL OR char_length(file_name) <= 200),
  mime text CHECK (mime IS NULL OR char_length(mime) <= 100),
  size_bytes bigint,
  caption text CHECK (caption IS NULL OR char_length(caption) <= 500),
  -- both
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  taken_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid NOT NULL,
  recorded_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'statement' AND statement IS NOT NULL AND given_by_name IS NOT NULL) OR (kind = 'media' AND path IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS voyage_records_voyage_idx ON public.voyage_records (voyage_id, created_at);
ALTER TABLE public.voyage_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "voyage_records_read" ON public.voyage_records;
CREATE POLICY "voyage_records_read" ON public.voyage_records FOR SELECT TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin']::public.app_role[]));
