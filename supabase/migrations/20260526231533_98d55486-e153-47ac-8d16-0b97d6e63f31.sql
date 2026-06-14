
-- ============ ROLES ============
CREATE TYPE public.app_role AS ENUM ('manager', 'supervisor', 'officer', 'client_admin');

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT '',
  zone TEXT,
  status TEXT NOT NULL DEFAULT 'off-duty',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles readable by authenticated" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "Roles readable by authenticated" ON public.user_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Managers manage roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'manager'))
  WITH CHECK (public.has_role(auth.uid(), 'manager'));

-- ============ INCIDENTS ============
CREATE TYPE public.incident_status AS ENUM ('reported','acknowledged','responding','contained','resolved','escalated');
CREATE TYPE public.incident_type AS ENUM ('intrusion','theft','medical','fire','suspicious','civil_unrest','other');

CREATE TABLE public.incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE DEFAULT ('LEM-' || lpad((floor(random()*9000)+1000)::text, 4, '0')),
  type public.incident_type NOT NULL DEFAULT 'other',
  severity SMALLINT NOT NULL CHECK (severity BETWEEN 1 AND 5),
  status public.incident_status NOT NULL DEFAULT 'reported',
  location TEXT NOT NULL,
  zone TEXT NOT NULL,
  coord_x NUMERIC,
  coord_y NUMERIC,
  description TEXT,
  reported_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  officer TEXT,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.incidents TO authenticated;
GRANT ALL ON public.incidents TO service_role;
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Incidents readable by authenticated" ON public.incidents FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated create incidents" ON public.incidents FOR INSERT TO authenticated WITH CHECK (auth.uid() = reported_by);
CREATE POLICY "Managers/supervisors edit incidents" ON public.incidents FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'supervisor'));
CREATE POLICY "Managers delete incidents" ON public.incidents FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'manager'));

-- ============ PATROLS ============
CREATE TABLE public.patrols (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  officer TEXT NOT NULL,
  shift TEXT NOT NULL,
  waypoints INTEGER NOT NULL DEFAULT 0,
  checked_in INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'on_route',
  next_check_in TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.patrols TO authenticated;
GRANT ALL ON public.patrols TO service_role;
ALTER TABLE public.patrols ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Patrols readable by authenticated" ON public.patrols FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated create patrols" ON public.patrols FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Managers/supervisors edit patrols" ON public.patrols FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'supervisor'));
CREATE POLICY "Managers delete patrols" ON public.patrols FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'manager'));

-- ============ ALERTS ============
CREATE TABLE public.alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE DEFAULT ('AL-' || lpad((floor(random()*900)+100)::text, 3, '0')),
  title TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'in-app',
  severity SMALLINT NOT NULL CHECK (severity BETWEEN 1 AND 5),
  recipients INTEGER NOT NULL DEFAULT 0,
  acknowledged BOOLEAN NOT NULL DEFAULT false,
  incident_id UUID REFERENCES public.incidents(id) ON DELETE SET NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.alerts TO authenticated;
GRANT ALL ON public.alerts TO service_role;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Alerts readable by authenticated" ON public.alerts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated create alerts" ON public.alerts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Managers/supervisors edit alerts" ON public.alerts FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'supervisor'));
CREATE POLICY "Managers delete alerts" ON public.alerts FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'manager'));

-- ============ TRIGGERS ============
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_incidents_updated BEFORE UPDATE ON public.incidents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_patrols_updated BEFORE UPDATE ON public.patrols
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ HANDLE NEW USER ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email,'@',1)));
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'officer');
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.incidents;
ALTER PUBLICATION supabase_realtime ADD TABLE public.alerts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.patrols;
