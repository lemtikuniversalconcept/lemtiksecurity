-- ============================================================
-- ISPS broadcasts and reminders.
--   isps_broadcasts            a security level change, an authority notice or a
--                              drill/plan reminder sent to people in an organisation
--   isps_broadcast_recipients  one row per person: how it reached them and when
--                              they acknowledged it
--   isps_reminders             which reminders have been sent, so each goes once
-- Written by the server only.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.isps_broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('level_change', 'authority_notice', 'reminder')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  body text NOT NULL CHECK (char_length(body) <= 4000),
  level integer CHECK (level BETWEEN 1 AND 3),
  facility_ids uuid[] NOT NULL DEFAULT '{}',
  notice_id uuid REFERENCES public.authority_notices(id) ON DELETE SET NULL,
  require_ack boolean NOT NULL DEFAULT true,
  chase_every_min integer NOT NULL DEFAULT 15 CHECK (chase_every_min BETWEEN 5 AND 1440),
  max_chases integer NOT NULL DEFAULT 3 CHECK (max_chases BETWEEN 0 AND 10),
  chases_sent integer NOT NULL DEFAULT 0,
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_by uuid,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS isps_broadcasts_org_idx ON public.isps_broadcasts (organisation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS isps_broadcasts_open_idx ON public.isps_broadcasts (closed_at) WHERE closed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.isps_broadcast_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id uuid NOT NULL REFERENCES public.isps_broadcasts(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text,
  role text,
  channels_sent text[] NOT NULL DEFAULT '{}',
  channels_failed text[] NOT NULL DEFAULT '{}',
  first_sent_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_via text CHECK (acknowledged_via IS NULL OR acknowledged_via IN ('app', 'telegram')),
  UNIQUE (broadcast_id, user_id)
);
CREATE INDEX IF NOT EXISTS isps_broadcast_recipients_user_idx ON public.isps_broadcast_recipients (user_id, acknowledged_at);

CREATE TABLE IF NOT EXISTS public.isps_reminders (
  facility_id uuid NOT NULL REFERENCES public.isps_facilities(id) ON DELETE CASCADE,
  reminder_key text NOT NULL CHECK (char_length(reminder_key) <= 120),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  broadcast_id uuid REFERENCES public.isps_broadcasts(id) ON DELETE SET NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (facility_id, reminder_key)
);

ALTER TABLE public.isps_broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.isps_broadcast_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.isps_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "isps_broadcasts_read" ON public.isps_broadcasts;
CREATE POLICY "isps_broadcasts_read" ON public.isps_broadcasts FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organisation_id));
DROP POLICY IF EXISTS "isps_broadcast_recipients_read" ON public.isps_broadcast_recipients;
CREATE POLICY "isps_broadcast_recipients_read" ON public.isps_broadcast_recipients FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin']::public.app_role[]));
DROP POLICY IF EXISTS "isps_reminders_read" ON public.isps_reminders;
CREATE POLICY "isps_reminders_read" ON public.isps_reminders FOR SELECT TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin']::public.app_role[]));
