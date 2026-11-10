-- ============================================================
-- Court-ready case files.
--
-- A case file is a frozen copy of an incident or a voyage at the moment
-- it was generated: the record, its timeline, every evidence file's
-- SHA-256 fingerprint and its chain of custody. The exact manifest text
-- is stored with its own SHA-256, so anyone holding the bundle can prove
-- that nothing in it has changed since. Rows can't be edited or deleted
-- by anyone using the app.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.case_files (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('incident', 'voyage')),
  record_id uuid NOT NULL,
  reference text NOT NULL,
  manifest_text text NOT NULL,
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  extra_files jsonb NOT NULL DEFAULT '[]'::jsonb,
  file_count integer NOT NULL DEFAULT 0,
  generated_by uuid NOT NULL,
  generated_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS case_files_record_idx ON public.case_files (organisation_id, kind, record_id, created_at DESC);

ALTER TABLE public.case_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "case_files_read" ON public.case_files;
CREATE POLICY "case_files_read" ON public.case_files FOR SELECT TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin','security_forensic_analyst']::public.app_role[]));

DROP POLICY IF EXISTS "case_files_insert" ON public.case_files;
CREATE POLICY "case_files_insert" ON public.case_files FOR INSERT TO authenticated
  WITH CHECK (
    generated_by = auth.uid()
    AND public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin','security_forensic_analyst']::public.app_role[])
  );
-- No UPDATE or DELETE policy: case files are append-only.
