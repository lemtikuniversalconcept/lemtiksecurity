-- ============================================================
-- LEMTIK — FORENSIC ANALYST + CONSUMER PWA: SHARED FOUNDATION
-- New role, new tables, storage bucket. No RLS policies added:
-- all four tables are read/written exclusively via the service-role
-- client (Relationship API / TanStack server functions), same
-- pattern already used for the `officers` table.
-- ============================================================

-- 1. NEW ROLE ---------------------------------------------------
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'security_forensic_analyst';

-- 2. CONSUMER SESSIONS (issued by an operator at guest check-in) --
CREATE TABLE public.consumer_sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   UUID NOT NULL REFERENCES public.organisations(id),
  location_id       UUID REFERENCES public.organisation_locations(id),
  token             TEXT NOT NULL UNIQUE,
  guest_reference   TEXT,
  premises_lat      NUMERIC(10, 7),
  premises_lng      NUMERIC(10, 7),
  premises_radius_m INTEGER DEFAULT 300,
  wifi_ssids        TEXT[],
  activated_at      TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  created_by        UUID REFERENCES auth.users(id),
  is_active         BOOLEAN DEFAULT TRUE
);

-- 3. CONSUMER EMERGENCY REPORTS -----------------------------------
CREATE TABLE public.consumer_reports (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID NOT NULL REFERENCES public.consumer_sessions(id),
  organisation_id   UUID NOT NULL REFERENCES public.organisations(id),
  incident_id       UUID REFERENCES public.incidents(id),
  report_type       TEXT DEFAULT 'emergency',
  description       TEXT,
  location_text     TEXT,
  lat               NUMERIC(10, 7),
  lng               NUMERIC(10, 7),
  accuracy_m        INTEGER,
  status            TEXT DEFAULT 'received',
  ai_transcription  TEXT,
  ai_language       TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- 4. MEDIA CHUNKS ATTACHED TO CONSUMER REPORTS ---------------------
CREATE TABLE public.consumer_report_media (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id     UUID NOT NULL REFERENCES public.consumer_reports(id),
  media_type    TEXT NOT NULL,
  storage_path  TEXT NOT NULL,
  chunk_index   INTEGER,
  duration_ms   INTEGER,
  captured_at   TIMESTAMPTZ DEFAULT NOW(),
  uploaded_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 5. FORENSIC AI QUERY LOG ------------------------------------------
CREATE TABLE public.forensic_ai_queries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analyst_id      UUID NOT NULL REFERENCES auth.users(id),
  organisation_id UUID NOT NULL REFERENCES public.organisations(id),
  incident_id     UUID REFERENCES public.incidents(id),
  query_text      TEXT NOT NULL,
  response_text   TEXT,
  response_mode   TEXT DEFAULT 'plain',
  model_used      TEXT,
  prompt_version  TEXT,
  confidence      NUMERIC(4, 2),
  latency_ms      INTEGER,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 6. RLS (enabled, zero policies — service-role only, by design) ---
ALTER TABLE public.consumer_sessions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consumer_reports      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consumer_report_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forensic_ai_queries   ENABLE ROW LEVEL SECURITY;

-- 7. INDEXES ----------------------------------------------------
CREATE INDEX idx_consumer_sessions_token   ON public.consumer_sessions(token);
CREATE INDEX idx_consumer_sessions_org     ON public.consumer_sessions(organisation_id);
CREATE INDEX idx_consumer_reports_session  ON public.consumer_reports(session_id);
CREATE INDEX idx_consumer_reports_incident ON public.consumer_reports(incident_id);
CREATE INDEX idx_consumer_media_report     ON public.consumer_report_media(report_id);
CREATE INDEX idx_forensic_ai_analyst       ON public.forensic_ai_queries(analyst_id);

-- 8. STORAGE BUCKET (private — served only via signed URLs) --------
INSERT INTO storage.buckets (id, name, public)
VALUES ('consumer-media', 'consumer-media', false)
ON CONFLICT (id) DO NOTHING;
