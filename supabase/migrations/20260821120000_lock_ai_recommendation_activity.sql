-- AI recommendations and the operator decisions made against them are the
-- accountability trail this product is pitched on ("AI recommended X, operator
-- reviewed and changed to Y"). incident_activity already has no UPDATE/DELETE
-- grant for `authenticated`, but service_role bypasses that. Mirror the
-- append-only pattern already used for audit_log (see
-- 20260621000100_blackbox_audit_trail.sql) so these two specific activity
-- kinds can never be altered or deleted by anyone, including service_role,
-- once written. Every other activity kind on this table is left exactly as
-- it was.

CREATE OR REPLACE FUNCTION public.block_locked_incident_activity_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.kind IN ('ai_recommendation', 'operator_decision') THEN
    RAISE EXCEPTION 'incident_activity rows of kind "%" are append-only', OLD.kind;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_block_locked_incident_activity_update ON public.incident_activity;
CREATE TRIGGER trg_block_locked_incident_activity_update
BEFORE UPDATE ON public.incident_activity
FOR EACH ROW EXECUTE FUNCTION public.block_locked_incident_activity_mutation();

DROP TRIGGER IF EXISTS trg_block_locked_incident_activity_delete ON public.incident_activity;
CREATE TRIGGER trg_block_locked_incident_activity_delete
BEFORE DELETE ON public.incident_activity
FOR EACH ROW EXECUTE FUNCTION public.block_locked_incident_activity_mutation();

-- service_role already has ALL on this table (needed for INSERT from
-- relationship_api and the console app); the trigger above is what actually
-- protects these two kinds now that UPDATE/DELETE grants alone aren't enough.

CREATE INDEX IF NOT EXISTS idx_incident_activity_kind ON public.incident_activity (kind);
