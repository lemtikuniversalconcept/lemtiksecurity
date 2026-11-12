-- ============================================================
-- F4 (part): incident shares. One incident, voyage or movement alert shared with
-- a partner organisation or through a link, with a scope, an expiry, who approved
-- it, when it was first opened and when it was acknowledged. Every view and action
-- is logged in record_share_events. Written by the server only.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.record_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  record_kind text NOT NULL CHECK (record_kind IN ('incident', 'voyage', 'movement_alert')),
  record_id uuid NOT NULL,
  record_label text NOT NULL CHECK (char_length(record_label) BETWEEN 1 AND 200),
  partner_org_id uuid REFERENCES public.organisations(id) ON DELETE CASCADE,
  share_token text UNIQUE CHECK (share_token IS NULL OR char_length(share_token) BETWEEN 24 AND 64),
  recipient_label text NOT NULL CHECK (char_length(recipient_label) BETWEEN 1 AND 160),
  recipient_contact text CHECK (recipient_contact IS NULL OR char_length(recipient_contact) <= 160),
  scopes text[] NOT NULL DEFAULT '{summary}',
  purpose text NOT NULL CHECK (char_length(purpose) BETWEEN 3 AND 500),
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval', 'active', 'declined', 'revoked')),
  requested_by uuid NOT NULL,
  requested_by_name text,
  approved_by uuid,
  approved_by_name text,
  approved_at timestamptz,
  decline_reason text CHECK (decline_reason IS NULL OR char_length(decline_reason) <= 500),
  first_viewed_at timestamptz,
  view_count integer NOT NULL DEFAULT 0,
  acknowledged_at timestamptz,
  acknowledged_by_name text CHECK (acknowledged_by_name IS NULL OR char_length(acknowledged_by_name) <= 120),
  ack_note text CHECK (ack_note IS NULL OR char_length(ack_note) <= 1000),
  revoked_at timestamptz,
  revoked_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((partner_org_id IS NOT NULL) <> (share_token IS NOT NULL)),
  CHECK (scopes <@ ARRAY['summary','location','track','evidence','people']::text[])
);
CREATE INDEX IF NOT EXISTS record_shares_record_idx ON public.record_shares (organisation_id, record_kind, record_id);
CREATE INDEX IF NOT EXISTS record_shares_partner_idx ON public.record_shares (partner_org_id, created_at DESC) WHERE partner_org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS record_shares_pending_idx ON public.record_shares (organisation_id) WHERE status = 'pending_approval';

CREATE TABLE IF NOT EXISTS public.record_share_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id uuid NOT NULL REFERENCES public.record_shares(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('requested', 'approved', 'declined', 'viewed', 'acknowledged', 'revoked')),
  actor_name text,
  actor_org_name text,
  via text CHECK (via IS NULL OR via IN ('app', 'link')),
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS record_share_events_share_idx ON public.record_share_events (share_id, created_at);

ALTER TABLE public.record_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.record_share_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "record_shares_read" ON public.record_shares;
CREATE POLICY "record_shares_read" ON public.record_shares FOR SELECT TO authenticated
  USING (
    public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin']::public.app_role[])
    OR (partner_org_id IS NOT NULL AND status = 'active' AND public.has_org_role(auth.uid(), partner_org_id, ARRAY['manager','supervisor','client_admin']::public.app_role[]))
  );
DROP POLICY IF EXISTS "record_share_events_read" ON public.record_share_events;
CREATE POLICY "record_share_events_read" ON public.record_share_events FOR SELECT TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin']::public.app_role[]));
