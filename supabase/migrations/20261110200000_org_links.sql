-- ============================================================
-- Links between organisations.
--
-- An organisation (the owner, e.g. a boat operator) can share chosen parts
-- of its operational picture with another organisation (an authority such
-- as NIMASA or the marine police, or a responder) for a limited time. The
-- receiver must accept; the owner can revoke at any moment; access stops
-- automatically at expiry. Every step, and every time the receiver opens
-- the shared view, is logged where BOTH organisations can see it.
--
-- Shared data is never exposed through table policies: it is read by the
-- server only after checking an active, unexpired link, and only the
-- fields the scope allows (tracker secrets and personal details never).
-- ============================================================

ALTER TYPE public.org_type ADD VALUE IF NOT EXISTS 'maritime_operator';
ALTER TYPE public.org_type ADD VALUE IF NOT EXISTS 'authority';
ALTER TYPE public.org_type ADD VALUE IF NOT EXISTS 'responder';

CREATE TABLE IF NOT EXISTS public.org_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_org_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  partner_org_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  scopes text[] NOT NULL CHECK (array_length(scopes, 1) >= 1 AND scopes <@ ARRAY['vessels', 'voyages', 'alerts', 'search_rescue', 'corridors', 'isps', 'people']::text[]),
  purpose text NOT NULL CHECK (char_length(purpose) BETWEEN 3 AND 500),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'declined', 'revoked')),
  expires_at timestamptz NOT NULL,
  created_by uuid NOT NULL,
  created_by_name text,
  responded_by uuid,
  responded_by_name text,
  responded_at timestamptz,
  revoked_by uuid,
  revoked_by_name text,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (owner_org_id <> partner_org_id)
);
CREATE INDEX IF NOT EXISTS org_links_owner_idx ON public.org_links (owner_org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS org_links_partner_idx ON public.org_links (partner_org_id, created_at DESC);
ALTER TABLE public.org_links ENABLE ROW LEVEL SECURITY;
-- Both sides' managers, operators and client admins can see the link itself.
DROP POLICY IF EXISTS "org_links_read" ON public.org_links;
CREATE POLICY "org_links_read" ON public.org_links FOR SELECT TO authenticated
  USING (
    public.has_org_role(auth.uid(), owner_org_id, ARRAY['manager','supervisor','client_admin']::public.app_role[])
    OR public.has_org_role(auth.uid(), partner_org_id, ARRAY['manager','supervisor','client_admin']::public.app_role[])
  );
-- Writes go through the server (which checks who may create, accept or revoke).

CREATE TABLE IF NOT EXISTS public.org_link_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES public.org_links(id) ON DELETE CASCADE,
  owner_org_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  partner_org_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  actor_id uuid,
  actor_name text,
  actor_org_id uuid,
  action text NOT NULL CHECK (action IN ('offered', 'accepted', 'declined', 'revoked', 'viewed', 'imported_corridor')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS org_link_events_link_idx ON public.org_link_events (link_id, created_at DESC);
ALTER TABLE public.org_link_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_link_events_read" ON public.org_link_events;
CREATE POLICY "org_link_events_read" ON public.org_link_events FOR SELECT TO authenticated
  USING (
    public.has_org_role(auth.uid(), owner_org_id, ARRAY['manager','supervisor','client_admin']::public.app_role[])
    OR public.has_org_role(auth.uid(), partner_org_id, ARRAY['manager','supervisor','client_admin']::public.app_role[])
  );
-- No insert/update/delete policies: the log is written only by the server and can't be edited.
