
-- Audit log table
CREATE TABLE public.audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_id UUID,
  actor_name TEXT,
  entity TEXT NOT NULL,
  entity_id UUID,
  action TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Audit readable by managers/supervisors"
ON public.audit_log FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'supervisor'::app_role));

CREATE POLICY "Authenticated insert audit"
ON public.audit_log FOR INSERT TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

CREATE INDEX idx_audit_created ON public.audit_log (created_at DESC);
CREATE INDEX idx_audit_entity ON public.audit_log (entity, entity_id);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_log;
