-- Reports by Telegram bot.
--
--   telegram_report_links   an organisation's public link for community reports (one active per org)
--   telegram_reporters      community reporters, known to the organisation only by a number
--   telegram_report_drafts  a report being put together in a chat (description, photos, location)
--
-- All written by the server. Reporters' Telegram chat ids are never shown in the app.

CREATE TABLE IF NOT EXISTS public.telegram_report_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  label text CHECK (char_length(label) <= 120),
  daily_limit integer NOT NULL DEFAULT 10 CHECK (daily_limit BETWEEN 1 AND 100),
  created_by uuid,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS telegram_report_links_active_idx ON public.telegram_report_links (organisation_id) WHERE revoked_at IS NULL;
ALTER TABLE public.telegram_report_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "telegram_report_links_read" ON public.telegram_report_links;
CREATE POLICY "telegram_report_links_read" ON public.telegram_report_links FOR SELECT TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor']::public.app_role[]));

CREATE TABLE IF NOT EXISTS public.telegram_reporters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  chat_id bigint NOT NULL,
  number integer NOT NULL,
  reports integer NOT NULL DEFAULT 0,
  day date,                                -- Lagos day of day_count, for the daily limit
  day_count integer NOT NULL DEFAULT 0,
  blocked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_report_at timestamptz,
  last_started_at timestamptz NOT NULL DEFAULT now(), -- the org a chat reports to is the one whose link it opened last
  UNIQUE (organisation_id, chat_id),
  UNIQUE (organisation_id, number)
);
ALTER TABLE public.telegram_reporters ENABLE ROW LEVEL SECURITY;
-- No policies: server only.

CREATE TABLE IF NOT EXISTS public.telegram_report_drafts (
  chat_id bigint PRIMARY KEY,
  organisation_id uuid REFERENCES public.organisations(id) ON DELETE CASCADE,
  user_id uuid,
  reporter_id uuid REFERENCES public.telegram_reporters(id) ON DELETE CASCADE,
  category text,
  text text NOT NULL DEFAULT '' CHECK (char_length(text) <= 4000),
  photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  lat double precision,
  lng double precision,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.telegram_report_drafts ENABLE ROW LEVEL SECURITY;
-- No policies: server only.
