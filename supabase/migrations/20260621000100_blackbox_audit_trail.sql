-- Expand the existing audit log into a black-box trail while keeping the
-- legacy columns intact for existing app reads.

ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS "timestamp" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS org_id UUID,
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS user_role TEXT,
  ADD COLUMN IF NOT EXISTS user_email TEXT,
  ADD COLUMN IF NOT EXISTS action_type TEXT,
  ADD COLUMN IF NOT EXISTS resource_type TEXT,
  ADD COLUMN IF NOT EXISTS resource_id TEXT,
  ADD COLUMN IF NOT EXISTS action_detail JSONB,
  ADD COLUMN IF NOT EXISTS old_value JSONB,
  ADD COLUMN IF NOT EXISTS new_value JSONB,
  ADD COLUMN IF NOT EXISTS ip_address TEXT,
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS session_id TEXT,
  ADD COLUMN IF NOT EXISTS request_id TEXT,
  ADD COLUMN IF NOT EXISTS success BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS error_message TEXT;

UPDATE public.audit_log
SET
  "timestamp" = COALESCE("timestamp", created_at),
  org_id = COALESCE(org_id, organisation_id),
  user_id = COALESCE(user_id, actor_id),
  action_type = COALESCE(action_type, action),
  resource_type = COALESCE(resource_type, entity),
  resource_id = COALESCE(resource_id, entity_id::text),
  action_detail = COALESCE(action_detail, details),
  success = COALESCE(success, TRUE)
WHERE
  "timestamp" IS NULL
  OR org_id IS NULL
  OR user_id IS NULL
  OR action_type IS NULL
  OR resource_type IS NULL
  OR resource_id IS NULL
  OR action_detail IS NULL
  OR success IS NULL;

-- Deleting an organisation used to SET NULL its audit rows, which the append-only trigger
-- below would block (so the delete would fail). Audit rows keep the organisation's id instead.
ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_organisation_id_fkey;

CREATE OR REPLACE FUNCTION public.block_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_block_audit_log_update ON public.audit_log;
CREATE TRIGGER trg_block_audit_log_update
BEFORE UPDATE ON public.audit_log
FOR EACH ROW EXECUTE FUNCTION public.block_audit_log_mutation();

DROP TRIGGER IF EXISTS trg_block_audit_log_delete ON public.audit_log;
CREATE TRIGGER trg_block_audit_log_delete
BEFORE DELETE ON public.audit_log
FOR EACH ROW EXECUTE FUNCTION public.block_audit_log_mutation();

REVOKE UPDATE, DELETE ON public.audit_log FROM authenticated, anon, service_role;
GRANT SELECT, INSERT ON public.audit_log TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS idx_audit_ts ON public.audit_log ("timestamp" DESC);
CREATE INDEX IF NOT EXISTS idx_audit_org_id ON public.audit_log (org_id);
CREATE INDEX IF NOT EXISTS idx_audit_user_id ON public.audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action_type ON public.audit_log (action_type);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON public.audit_log (resource_type, resource_id);
