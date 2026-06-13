
-- Profile extensions for user management
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS employee_id TEXT,
  ADD COLUMN IF NOT EXISTS photo_url TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assigned_location_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];

-- Invitations
CREATE TABLE IF NOT EXISTS public.user_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL,
  email TEXT NOT NULL,
  role public.app_role NOT NULL DEFAULT 'officer',
  assigned_location_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  invited_by UUID NOT NULL,
  invited_by_name TEXT,
  token TEXT NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(16), 'hex'),
  status TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | cancelled | expired
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '48 hours'),
  accepted_at TIMESTAMPTZ,
  accepted_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_invites_org_idx ON public.user_invites(organisation_id);
CREATE INDEX IF NOT EXISTS user_invites_email_idx ON public.user_invites(lower(email));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_invites TO authenticated;
GRANT ALL ON public.user_invites TO service_role;

ALTER TABLE public.user_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read org invites" ON public.user_invites
  FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organisation_id));

CREATE POLICY "Admins manage invites" ON public.user_invites
  FOR ALL TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','client_admin']::public.app_role[]))
  WITH CHECK (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','client_admin']::public.app_role[]));

CREATE TRIGGER user_invites_updated_at BEFORE UPDATE ON public.user_invites
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
