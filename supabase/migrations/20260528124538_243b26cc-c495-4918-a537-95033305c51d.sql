-- Remove audit_log from realtime publication to prevent SELECT RLS bypass via realtime broadcasts
ALTER PUBLICATION supabase_realtime DROP TABLE public.audit_log;

-- Enable RLS on realtime.messages to scope channel subscriptions
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to subscribe to operational channels (incidents, patrols, alerts)
-- These tables already have SELECT policies allowing all authenticated users to read.
CREATE POLICY "Authenticated can receive operational realtime"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  (realtime.topic() IN ('realtime:incidents', 'realtime:patrols', 'realtime:alerts'))
  OR (
    realtime.topic() = 'realtime:audit_log'
    AND (
      public.has_role(auth.uid(), 'manager'::public.app_role)
      OR public.has_role(auth.uid(), 'supervisor'::public.app_role)
    )
  )
);
