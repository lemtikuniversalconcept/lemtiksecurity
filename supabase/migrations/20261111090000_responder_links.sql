-- ============================================================
-- Responder link: a hand-off now carries a time-limited link the responder opens
-- without an account. It shows the boat, its recent track and the people aboard,
-- and lets the responder confirm receipt and report progress
-- (dispatched, on scene, resolved). The operator can withdraw the link.
-- Everything is written by the server; responders never touch the tables directly.
-- ============================================================

ALTER TABLE public.movement_handoffs
  ADD COLUMN IF NOT EXISTS share_token text UNIQUE,
  ADD COLUMN IF NOT EXISTS share_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'sent',
  ADD COLUMN IF NOT EXISTS status_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_viewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS operator_phone text,
  ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz,
  ADD COLUMN IF NOT EXISTS withdrawn_by_name text;

ALTER TABLE public.movement_handoffs DROP CONSTRAINT IF EXISTS movement_handoffs_status_check;
ALTER TABLE public.movement_handoffs ADD CONSTRAINT movement_handoffs_status_check
  CHECK (status IN ('sent', 'acknowledged', 'dispatched', 'on_scene', 'resolved', 'withdrawn'));

CREATE TABLE IF NOT EXISTS public.movement_handoff_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handoff_id uuid NOT NULL REFERENCES public.movement_handoffs(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('viewed', 'acknowledged', 'dispatched', 'on_scene', 'resolved', 'withdrawn', 'note')),
  by_name text NOT NULL CHECK (char_length(by_name) BETWEEN 1 AND 120),
  by_responder boolean NOT NULL DEFAULT true,
  note text CHECK (note IS NULL OR char_length(note) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS movement_handoff_updates_idx ON public.movement_handoff_updates (handoff_id, created_at);
ALTER TABLE public.movement_handoff_updates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "movement_handoff_updates_read" ON public.movement_handoff_updates;
CREATE POLICY "movement_handoff_updates_read" ON public.movement_handoff_updates FOR SELECT TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin']::public.app_role[]));

ALTER TABLE public.movement_alerts DROP CONSTRAINT IF EXISTS movement_alerts_kind_check;
ALTER TABLE public.movement_alerts ADD CONSTRAINT movement_alerts_kind_check CHECK (kind IN (
  'sos', 'man_overboard', 'zone_enter', 'zone_exit', 'silent', 'stopped', 'unexpected_stop', 'tracking_resumed',
  'checkin', 'checkin_missed', 'off_route', 'back_on_route', 'overdue', 'voyage_started', 'voyage_completed',
  'headcount_mismatch', 'curfew', 'boarding_override', 'handoff', 'responder_update', 'possible_hijack', 'hijack_review'
));

-- ---------- Possible-hijack flag ----------
-- Raised by the scheduled checks when an underway voyage shows two or more warning signs
-- together (off route, stopped away from a safe place, tracker silent, missed check-in,
-- entering a restricted zone). An operator then confirms it (and hands off) or dismisses it
-- as a false alarm with a reason. Nothing is shared outside the organisation automatically.
ALTER TABLE public.movement_voyages
  ADD COLUMN IF NOT EXISTS hijack_flagged_at timestamptz,
  ADD COLUMN IF NOT EXISTS hijack_signals jsonb,
  ADD COLUMN IF NOT EXISTS hijack_review text CHECK (hijack_review IS NULL OR hijack_review IN ('confirmed', 'dismissed')),
  ADD COLUMN IF NOT EXISTS hijack_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS hijack_reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS hijack_reviewed_by_name text,
  ADD COLUMN IF NOT EXISTS hijack_review_note text CHECK (hijack_review_note IS NULL OR char_length(hijack_review_note) <= 1000);
