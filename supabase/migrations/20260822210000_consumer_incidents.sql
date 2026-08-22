-- ============================================================
-- Fold consumer-reported emergencies into the main incidents table
-- instead of a parallel consumer_reports flow, so the existing
-- incident detail/forensic screens work on them with no new views —
-- just a distinguishing tag the dashboard can flash on.
-- ============================================================

ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'dashboard',
  ADD COLUMN IF NOT EXISTS consumer_session_id UUID REFERENCES public.consumer_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_incidents_source ON public.incidents(source);
CREATE INDEX IF NOT EXISTS idx_incidents_consumer_session ON public.incidents(consumer_session_id);

-- Unacknowledged consumer-reported incidents are what the dashboard flashes on —
-- this index keeps that "is there anything urgent right now" check cheap per org.
CREATE INDEX IF NOT EXISTS idx_incidents_unacked_consumer
  ON public.incidents(organisation_id)
  WHERE source = 'consumer_pwa' AND acknowledged_at IS NULL;
