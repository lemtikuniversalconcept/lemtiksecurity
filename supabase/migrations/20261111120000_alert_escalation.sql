-- ============================================================
-- F2 (part): escalation chain and delivery log for serious movement alerts
-- (SOS, man overboard, possible hijack, off route, overdue, ...).
--
-- Each organisation has an escalation policy: a list of steps, each with a delay after the
-- alert, the roles to reach and the channels to use (in-app, email). The every-minute checks
-- send each step that is due while the alert is still unacknowledged. Acknowledging the alert
-- stops it. Every send (or failure, or skip) is written to alert_deliveries, which becomes
-- part of the record of the incident.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.escalation_policies (
  organisation_id uuid PRIMARY KEY REFERENCES public.organisations(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  min_severity smallint NOT NULL DEFAULT 4 CHECK (min_severity BETWEEN 1 AND 5),
  steps jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_by_name text
);
ALTER TABLE public.escalation_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "escalation_policies_read" ON public.escalation_policies;
CREATE POLICY "escalation_policies_read" ON public.escalation_policies FOR SELECT TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin']::public.app_role[]));
-- Written by the server only (managers, checked in code).

ALTER TABLE public.movement_alerts
  ADD COLUMN IF NOT EXISTS escalation_step smallint NOT NULL DEFAULT -1,
  ADD COLUMN IF NOT EXISTS escalation_next_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalation_done boolean NOT NULL DEFAULT false;
-- Alerts that existed before escalation was switched on are not escalated.
UPDATE public.movement_alerts SET escalation_done = true WHERE escalation_done = false;
CREATE INDEX IF NOT EXISTS movement_alerts_escalation_idx ON public.movement_alerts (organisation_id, created_at)
  WHERE acknowledged_at IS NULL AND escalation_done = false;

CREATE TABLE IF NOT EXISTS public.alert_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  movement_alert_id uuid REFERENCES public.movement_alerts(id) ON DELETE CASCADE,
  step smallint NOT NULL,
  channel text NOT NULL CHECK (channel IN ('in_app', 'email', 'push', 'telegram', 'sms', 'whatsapp')),
  recipient_user_id uuid,
  recipient_label text,
  status text NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  detail text CHECK (detail IS NULL OR char_length(detail) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alert_deliveries_alert_idx ON public.alert_deliveries (movement_alert_id, created_at);
CREATE INDEX IF NOT EXISTS alert_deliveries_org_idx ON public.alert_deliveries (organisation_id, created_at DESC);
ALTER TABLE public.alert_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "alert_deliveries_read" ON public.alert_deliveries;
CREATE POLICY "alert_deliveries_read" ON public.alert_deliveries FOR SELECT TO authenticated
  USING (public.has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin']::public.app_role[]));
