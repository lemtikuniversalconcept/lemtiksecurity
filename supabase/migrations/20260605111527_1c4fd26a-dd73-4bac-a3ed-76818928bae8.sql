
-- Extend alerts
ALTER TABLE public.alerts
  ADD COLUMN IF NOT EXISTS alert_type text NOT NULL DEFAULT 'incident_critical',
  ADD COLUMN IF NOT EXISTS body text,
  ADD COLUMN IF NOT EXISTS action text,
  ADD COLUMN IF NOT EXISTS channels text[] NOT NULL DEFAULT ARRAY['in-app']::text[],
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'delivered',
  ADD COLUMN IF NOT EXISTS delivered_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz,
  ADD COLUMN IF NOT EXISTS recipient_user_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[];

-- Per-user read tracking
CREATE TABLE IF NOT EXISTS public.notification_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id uuid NOT NULL REFERENCES public.alerts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (alert_id, user_id)
);
GRANT SELECT, INSERT, DELETE ON public.notification_reads TO authenticated;
GRANT ALL ON public.notification_reads TO service_role;
ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "User reads own notification reads" ON public.notification_reads
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "User marks own notification read" ON public.notification_reads
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "User clears own notification read" ON public.notification_reads
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Per-org preferences
CREATE TABLE IF NOT EXISTS public.alert_preferences (
  organisation_id uuid PRIMARY KEY,
  enabled_types text[] NOT NULL DEFAULT ARRAY[
    'incident_critical','incident_high','incident_assigned',
    'missed_checkin','prolonged_missed','shift_start','shift_handover',
    'daily_summary','weekly_brief','osint_threat','sos'
  ]::text[],
  channel_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  quiet_hours jsonb NOT NULL DEFAULT '{"enabled":true,"start":"23:00","end":"06:00"}'::jsonb,
  extra_recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  language text NOT NULL DEFAULT 'en',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.alert_preferences TO authenticated;
GRANT ALL ON public.alert_preferences TO service_role;
ALTER TABLE public.alert_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read prefs" ON public.alert_preferences
  FOR SELECT TO authenticated USING (is_org_member(auth.uid(), organisation_id));
CREATE POLICY "Leadership writes prefs" ON public.alert_preferences
  FOR INSERT TO authenticated WITH CHECK (has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin']::app_role[]));
CREATE POLICY "Leadership updates prefs" ON public.alert_preferences
  FOR UPDATE TO authenticated USING (has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin']::app_role[]));

-- Trigger: dispatch alert on incident insert for sev 4/5
CREATE OR REPLACE FUNCTION public.dispatch_incident_alert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _type text;
  _label text;
  _channels text[];
  _recipients uuid[];
  _pref public.alert_preferences%ROWTYPE;
  _lang text;
BEGIN
  IF NEW.severity < 4 THEN RETURN NEW; END IF;
  IF NEW.severity = 5 THEN
    _type := 'incident_critical'; _label := 'CRITICAL';
    _channels := ARRAY['whatsapp','sms','in-app']::text[];
  ELSE
    _type := 'incident_high'; _label := 'HIGH';
    _channels := ARRAY['whatsapp','in-app']::text[];
  END IF;

  SELECT * INTO _pref FROM public.alert_preferences WHERE organisation_id = NEW.organisation_id;
  _lang := COALESCE(_pref.language, 'en');
  IF _pref.enabled_types IS NOT NULL AND NOT (_type = ANY(_pref.enabled_types)) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(array_agg(user_id), ARRAY[]::uuid[]) INTO _recipients
  FROM public.organisation_members
  WHERE organisation_id = NEW.organisation_id
    AND (NEW.severity = 5
         OR role = ANY(ARRAY['supervisor','manager','client_admin']::app_role[]));

  INSERT INTO public.alerts(
    title, body, action, channel, channels, severity, recipients,
    incident_id, organisation_id, alert_type, language, status,
    delivered_count, recipient_user_ids
  ) VALUES (
    'LEMTIK ALERT — ' || _label || ' · ' || COALESCE(NEW.title, NEW.type::text),
    'Location: ' || NEW.location || E'\nIncident: ' || NEW.type::text ||
      CASE WHEN NEW.description IS NOT NULL THEN E'\n' || left(NEW.description, 160) ELSE '' END,
    CASE WHEN NEW.severity = 5 THEN 'Dispatch nearest response team immediately'
         ELSE 'Acknowledge and assign responding officer' END,
    'in-app', _channels, NEW.severity, COALESCE(array_length(_recipients,1),0),
    NEW.id, NEW.organisation_id, _type, _lang, 'delivered',
    COALESCE(array_length(_recipients,1),0), _recipients
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_dispatch_incident_alert ON public.incidents;
CREATE TRIGGER trg_dispatch_incident_alert
  AFTER INSERT ON public.incidents
  FOR EACH ROW EXECUTE FUNCTION public.dispatch_incident_alert();

-- Trigger: incident_assigned alert when officer changes
CREATE OR REPLACE FUNCTION public.dispatch_assigned_alert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.officer IS NOT NULL AND COALESCE(OLD.officer,'') <> NEW.officer THEN
    INSERT INTO public.alerts(
      title, body, action, channel, channels, severity, recipients,
      incident_id, organisation_id, alert_type, status, delivered_count
    ) VALUES (
      'Assignment — ' || COALESCE(NEW.title, NEW.type::text),
      'You have been assigned to incident ' || NEW.code || ' at ' || NEW.location,
      'Acknowledge in the incident detail view',
      'in-app', ARRAY['in-app','whatsapp']::text[], NEW.severity, 1,
      NEW.id, NEW.organisation_id, 'incident_assigned', 'delivered', 1
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_dispatch_assigned_alert ON public.incidents;
CREATE TRIGGER trg_dispatch_assigned_alert
  AFTER UPDATE OF officer ON public.incidents
  FOR EACH ROW EXECUTE FUNCTION public.dispatch_assigned_alert();

CREATE INDEX IF NOT EXISTS idx_alerts_org_sent ON public.alerts(organisation_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_reads_user ON public.notification_reads(user_id);
