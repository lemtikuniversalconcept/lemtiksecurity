DROP POLICY IF EXISTS "Authenticated create alerts" ON public.alerts;
CREATE POLICY "Managers/supervisors create alerts"
ON public.alerts
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'manager'::public.app_role)
  OR public.has_role(auth.uid(), 'supervisor'::public.app_role)
);

DROP POLICY IF EXISTS "Authenticated create patrols" ON public.patrols;
CREATE POLICY "Managers/supervisors create patrols"
ON public.patrols
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'manager'::public.app_role)
  OR public.has_role(auth.uid(), 'supervisor'::public.app_role)
);

DROP POLICY IF EXISTS "Roles readable by authenticated" ON public.user_roles;
CREATE POLICY "Users and leadership can read roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (
  auth.uid() = user_id
  OR public.has_role(auth.uid(), 'manager'::public.app_role)
  OR public.has_role(auth.uid(), 'supervisor'::public.app_role)
);