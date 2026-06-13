-- Revoke anon EXECUTE on SECURITY DEFINER helpers (only authenticated callers
-- should ever invoke these via RLS / server functions).
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_org_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_org_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_org_role(uuid, uuid, public.app_role[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_lemtik_admin(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_org_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_org_role(uuid, uuid, public.app_role[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_lemtik_admin(uuid) TO authenticated, service_role;

-- Tighten org-logos bucket: prevent anonymous listing of all files in the
-- bucket. Public direct URLs (via /object/public/) keep working because the
-- public-bucket fast-path bypasses RLS for known object paths. Only members
-- of the owning org can browse / list logo objects.
DROP POLICY IF EXISTS "Public read org logos" ON storage.objects;

CREATE POLICY "Org members read org logos"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'org-logos'
  AND public.is_org_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
);
