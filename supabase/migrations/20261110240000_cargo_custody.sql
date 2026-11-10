-- ============================================================
-- Cargo custody: a consignment's chain of custody from loading to delivery.
--
-- Every custody event (loaded, sealed, checkpoint, handover, inspection,
-- delivered, exception) records where and when it happened, the seal numbers
-- seen, who handed over to whom, and photos or short video clips. Each event's
-- hash includes the previous event's hash, so the chain shows if any record is
-- removed or changed. Events are written only by the server and never edited.
-- Drivers without an account record events through a private link.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cargo_consignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  reference text NOT NULL,
  description text NOT NULL CHECK (char_length(description) BETWEEN 2 AND 500),
  quantity text CHECK (char_length(quantity) <= 120),
  container_numbers text[] NOT NULL DEFAULT '{}',
  seal_numbers text[] NOT NULL DEFAULT '{}',
  origin text NOT NULL CHECK (char_length(origin) BETWEEN 1 AND 200),
  destination text NOT NULL CHECK (char_length(destination) BETWEEN 1 AND 200),
  consignee text CHECK (char_length(consignee) <= 200),
  carrier text CHECK (char_length(carrier) <= 200),
  subject_id uuid REFERENCES public.movement_subjects(id) ON DELETE SET NULL,
  checkpoints jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{name, lat, lng, radius_m}]
  max_gap_hours integer NOT NULL DEFAULT 6 CHECK (max_gap_hours BETWEEN 1 AND 168),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_transit', 'delivered', 'cancelled')),
  has_exception boolean NOT NULL DEFAULT false,
  driver_token text UNIQUE,
  last_event_at timestamptz,
  gap_alerted boolean NOT NULL DEFAULT false,
  delivered_at timestamptz,
  created_by uuid,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, reference)
);
CREATE INDEX IF NOT EXISTS cargo_consignments_org_idx ON public.cargo_consignments (organisation_id, created_at DESC);
ALTER TABLE public.cargo_consignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cargo_consignments_read" ON public.cargo_consignments;
CREATE POLICY "cargo_consignments_read" ON public.cargo_consignments FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organisation_id));
-- Created and updated by the server (checks role), so the custody record stays consistent.

CREATE TABLE IF NOT EXISTS public.cargo_custody_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  consignment_id uuid NOT NULL REFERENCES public.cargo_consignments(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('loaded', 'sealed', 'departed', 'checkpoint', 'handover', 'inspection', 'delivered', 'exception')),
  checkpoint_index integer,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  device_at timestamptz,
  lat double precision,
  lng double precision,
  accuracy_m double precision,
  off_checkpoint_m integer,
  seals_observed text[] NOT NULL DEFAULT '{}',
  seals_ok boolean,
  seal_issue text,
  from_party text CHECK (char_length(from_party) <= 160),
  to_party text CHECK (char_length(to_party) <= 160),
  note text CHECK (char_length(note) <= 2000),
  media jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{path, name, type, size, sha256}]
  recorded_via text NOT NULL CHECK (recorded_via IN ('app', 'driver_link')),
  recorded_by uuid,
  recorded_by_name text NOT NULL,
  prev_hash text,
  event_hash text NOT NULL,
  UNIQUE (consignment_id, seq)
);
CREATE INDEX IF NOT EXISTS cargo_custody_events_c_idx ON public.cargo_custody_events (consignment_id, seq);
ALTER TABLE public.cargo_custody_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cargo_custody_events_read" ON public.cargo_custody_events;
CREATE POLICY "cargo_custody_events_read" ON public.cargo_custody_events FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organisation_id));
-- No insert/update/delete policies: written by the server only, never edited.

ALTER TABLE public.case_files DROP CONSTRAINT IF EXISTS case_files_kind_check;
ALTER TABLE public.case_files ADD CONSTRAINT case_files_kind_check CHECK (kind IN ('incident', 'voyage', 'consignment'));

-- Private bucket for custody photos and video clips (50 MB each). Read and written
-- only through short-lived signed links the server issues.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('custody-media', 'custody-media', false, 52428800, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
