-- ============================================================
-- F2 (part): Telegram alerts.
-- A user links their own Telegram chat by tapping "Connect Telegram" in Lemtik, which opens
-- the bot with a one-time code. The bot's webhook stores the chat. Escalation steps can then
-- send to Telegram, with an Acknowledge button in the message.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_telegram (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_id bigint NOT NULL UNIQUE,
  tg_username text,
  tg_name text,
  linked_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_telegram ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_telegram_own" ON public.user_telegram;
CREATE POLICY "user_telegram_own" ON public.user_telegram FOR SELECT TO authenticated USING (user_id = auth.uid());
-- Written by the server only.

CREATE TABLE IF NOT EXISTS public.telegram_link_codes (
  code text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS telegram_link_codes_user_idx ON public.telegram_link_codes (user_id, created_at DESC);
ALTER TABLE public.telegram_link_codes ENABLE ROW LEVEL SECURITY;
-- No policies: server only.
