DROP POLICY IF EXISTS "Authenticated insert audit" ON public.audit_log;

-- Backfill any null actor_ids defensively before tightening (no-op if none)
UPDATE public.audit_log SET actor_id = '00000000-0000-0000-0000-000000000000'::uuid WHERE actor_id IS NULL;

ALTER TABLE public.audit_log ALTER COLUMN actor_id SET NOT NULL;

CREATE POLICY "Authenticated insert audit"
ON public.audit_log
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = actor_id);
