REVOKE INSERT, UPDATE, DELETE ON public.audit_log FROM authenticated, anon;
GRANT ALL ON public.audit_log TO service_role;