
DROP POLICY "Authenticated create patrols" ON public.patrols;
CREATE POLICY "Authenticated create patrols" ON public.patrols FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY "Authenticated create alerts" ON public.alerts;
CREATE POLICY "Authenticated create alerts" ON public.alerts FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon;
