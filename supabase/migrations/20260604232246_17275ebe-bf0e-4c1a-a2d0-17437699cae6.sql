
ALTER TABLE public.patrols
  ADD COLUMN IF NOT EXISTS total_duration_minutes integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS grace_period_minutes integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS checkin_method text NOT NULL DEFAULT 'gps';

CREATE TABLE IF NOT EXISTS public.patrol_waypoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patrol_id uuid NOT NULL REFERENCES public.patrols(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL,
  ord smallint NOT NULL,
  name text NOT NULL,
  coord_x numeric,
  coord_y numeric,
  expected_minutes smallint NOT NULL DEFAULT 5,
  qr_token text NOT NULL DEFAULT encode(gen_random_bytes(8), 'hex'),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.patrol_waypoints TO authenticated;
GRANT ALL ON public.patrol_waypoints TO service_role;
ALTER TABLE public.patrol_waypoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read waypoints" ON public.patrol_waypoints FOR SELECT TO authenticated
  USING (is_org_member(auth.uid(), organisation_id));
CREATE POLICY "Leadership manage waypoints" ON public.patrol_waypoints FOR ALL TO authenticated
  USING (has_org_role(auth.uid(), organisation_id, ARRAY['manager'::app_role,'supervisor'::app_role,'client_admin'::app_role]))
  WITH CHECK (has_org_role(auth.uid(), organisation_id, ARRAY['manager'::app_role,'supervisor'::app_role,'client_admin'::app_role]));
CREATE INDEX IF NOT EXISTS idx_wp_patrol ON public.patrol_waypoints(patrol_id, ord);

CREATE TABLE IF NOT EXISTS public.patrol_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patrol_id uuid NOT NULL REFERENCES public.patrols(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL,
  officer_id uuid,
  backup_officer_id uuid,
  officer_name text,
  scheduled_start timestamptz NOT NULL,
  scheduled_end timestamptz NOT NULL,
  started_at timestamptz,
  ended_at timestamptz,
  handover_notes text,
  status text NOT NULL DEFAULT 'scheduled',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.patrol_shifts TO authenticated;
GRANT ALL ON public.patrol_shifts TO service_role;
ALTER TABLE public.patrol_shifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read shifts" ON public.patrol_shifts FOR SELECT TO authenticated
  USING (is_org_member(auth.uid(), organisation_id));
CREATE POLICY "Leadership manage shifts" ON public.patrol_shifts FOR ALL TO authenticated
  USING (has_org_role(auth.uid(), organisation_id, ARRAY['manager'::app_role,'supervisor'::app_role,'client_admin'::app_role]))
  WITH CHECK (has_org_role(auth.uid(), organisation_id, ARRAY['manager'::app_role,'supervisor'::app_role,'client_admin'::app_role]));
CREATE POLICY "Officer updates own shift" ON public.patrol_shifts FOR UPDATE TO authenticated
  USING (officer_id = auth.uid() OR backup_officer_id = auth.uid());
CREATE INDEX IF NOT EXISTS idx_shifts_org_time ON public.patrol_shifts(organisation_id, scheduled_start);

CREATE TABLE IF NOT EXISTS public.patrol_check_ins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.patrol_shifts(id) ON DELETE CASCADE,
  waypoint_id uuid NOT NULL REFERENCES public.patrol_waypoints(id) ON DELETE CASCADE,
  patrol_id uuid NOT NULL,
  organisation_id uuid NOT NULL,
  officer_id uuid,
  officer_name text,
  method text NOT NULL DEFAULT 'gps',
  coord_x numeric,
  coord_y numeric,
  distance_m numeric,
  status text NOT NULL DEFAULT 'on_time',
  minutes_late smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.patrol_check_ins TO authenticated;
GRANT ALL ON public.patrol_check_ins TO service_role;
ALTER TABLE public.patrol_check_ins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read checkins" ON public.patrol_check_ins FOR SELECT TO authenticated
  USING (is_org_member(auth.uid(), organisation_id));
CREATE POLICY "Members insert checkins" ON public.patrol_check_ins FOR INSERT TO authenticated
  WITH CHECK (is_org_member(auth.uid(), organisation_id) AND (officer_id IS NULL OR officer_id = auth.uid()));
CREATE INDEX IF NOT EXISTS idx_ci_shift ON public.patrol_check_ins(shift_id, created_at);

ALTER PUBLICATION supabase_realtime ADD TABLE public.patrol_waypoints;
ALTER PUBLICATION supabase_realtime ADD TABLE public.patrol_shifts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.patrol_check_ins;
