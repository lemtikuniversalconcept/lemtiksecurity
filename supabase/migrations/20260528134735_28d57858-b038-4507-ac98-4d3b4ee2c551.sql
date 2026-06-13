DROP POLICY IF EXISTS "Authenticated insert audit" ON public.audit_log;

REVOKE INSERT ON public.audit_log FROM authenticated;

CREATE OR REPLACE FUNCTION public.insert_audit_event(
  _entity text,
  _entity_id uuid,
  _action text,
  _details jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _actor_id uuid := auth.uid();
  _actor_name text;
  _audit_id uuid;
  _is_manager boolean;
  _is_supervisor boolean;
BEGIN
  IF _actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF _entity IS NULL OR length(_entity) > 50 OR _entity !~ '^[a-z_]+$' THEN
    RAISE EXCEPTION 'Invalid audit entity';
  END IF;

  IF _action IS NULL OR length(_action) > 50 OR _action !~ '^[a-z_]+$' THEN
    RAISE EXCEPTION 'Invalid audit action';
  END IF;

  _details := COALESCE(_details, '{}'::jsonb);

  IF jsonb_typeof(_details) <> 'object' OR pg_column_size(_details) > 8192 THEN
    RAISE EXCEPTION 'Invalid audit details';
  END IF;

  SELECT public.has_role(_actor_id, 'manager'::public.app_role) INTO _is_manager;
  SELECT public.has_role(_actor_id, 'supervisor'::public.app_role) INTO _is_supervisor;

  IF _entity = 'user_role' AND _action = 'assign_role' THEN
    IF NOT _is_manager THEN
      RAISE EXCEPTION 'Not authorized to record this audit event';
    END IF;

    IF NOT (_details ? 'role')
       OR (_details->>'role') NOT IN ('officer', 'supervisor', 'manager') THEN
      RAISE EXCEPTION 'Invalid audit details';
    END IF;
  ELSIF _entity = 'patrol' AND _action IN ('create', 'check_in', 'status_change') THEN
    IF NOT (_is_manager OR _is_supervisor) THEN
      RAISE EXCEPTION 'Not authorized to record this audit event';
    END IF;

    IF _action = 'status_change'
       AND (NOT (_details ? 'status') OR (_details->>'status') NOT IN ('on_route', 'delayed', 'missed', 'complete')) THEN
      RAISE EXCEPTION 'Invalid audit details';
    END IF;

    IF _action = 'check_in'
       AND (
         NOT (_details ? 'checked_in')
         OR NOT (_details ? 'total')
         OR jsonb_typeof(_details->'checked_in') <> 'number'
         OR jsonb_typeof(_details->'total') <> 'number'
       ) THEN
      RAISE EXCEPTION 'Invalid audit details';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported audit event';
  END IF;

  SELECT p.display_name INTO _actor_name
  FROM public.profiles p
  WHERE p.user_id = _actor_id
  LIMIT 1;

  INSERT INTO public.audit_log (actor_id, actor_name, entity, entity_id, action, details)
  VALUES (_actor_id, _actor_name, _entity, _entity_id, _action, _details)
  RETURNING id INTO _audit_id;

  RETURN _audit_id;
END;
$$;

REVOKE ALL ON FUNCTION public.insert_audit_event(text, uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.insert_audit_event(text, uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.insert_audit_event(text, uuid, text, jsonb) TO service_role;