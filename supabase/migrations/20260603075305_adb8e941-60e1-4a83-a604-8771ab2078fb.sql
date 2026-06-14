
-- Activity log (immutable per-incident timeline)
CREATE TABLE public.incident_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL,
  actor_id uuid,
  actor_name text,
  kind text NOT NULL, -- created | status_changed | assigned | note | client_note | evidence_added | escalation | link_added | reopened
  message text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_incident_activity_incident ON public.incident_activity(incident_id, created_at DESC);

GRANT SELECT, INSERT ON public.incident_activity TO authenticated;
GRANT ALL ON public.incident_activity TO service_role;

ALTER TABLE public.incident_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read org activity"
  ON public.incident_activity FOR SELECT TO authenticated
  USING (is_org_member(auth.uid(), organisation_id));

CREATE POLICY "Members insert own activity"
  ON public.incident_activity FOR INSERT TO authenticated
  WITH CHECK (is_org_member(auth.uid(), organisation_id) AND actor_id = auth.uid());

-- Notes (internal + client visible)
CREATE TABLE public.incident_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL,
  author_id uuid NOT NULL,
  author_name text,
  body text NOT NULL,
  client_visible boolean NOT NULL DEFAULT false,
  mentions uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_incident_notes_incident ON public.incident_notes(incident_id, created_at DESC);

GRANT SELECT, INSERT ON public.incident_notes TO authenticated;
GRANT ALL ON public.incident_notes TO service_role;

ALTER TABLE public.incident_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read org notes"
  ON public.incident_notes FOR SELECT TO authenticated
  USING (is_org_member(auth.uid(), organisation_id));

CREATE POLICY "Members write own notes"
  ON public.incident_notes FOR INSERT TO authenticated
  WITH CHECK (is_org_member(auth.uid(), organisation_id) AND author_id = auth.uid());

-- Links between incidents
CREATE TABLE public.incident_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  incident_id uuid NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
  linked_incident_id uuid NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (incident_id, linked_incident_id)
);

GRANT SELECT, INSERT, DELETE ON public.incident_links TO authenticated;
GRANT ALL ON public.incident_links TO service_role;

ALTER TABLE public.incident_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read links"
  ON public.incident_links FOR SELECT TO authenticated
  USING (is_org_member(auth.uid(), organisation_id));

CREATE POLICY "Members create links"
  ON public.incident_links FOR INSERT TO authenticated
  WITH CHECK (is_org_member(auth.uid(), organisation_id) AND created_by = auth.uid());

CREATE POLICY "Leadership deletes links"
  ON public.incident_links FOR DELETE TO authenticated
  USING (has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin']::app_role[]));

-- Escalations
CREATE TABLE public.incident_escalations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL,
  target text NOT NULL, -- police | lasema | nscdc | custom
  contact_name text,
  contact_phone text,
  message text NOT NULL,
  acknowledged boolean NOT NULL DEFAULT false,
  acknowledged_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_incident_escalations_incident ON public.incident_escalations(incident_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.incident_escalations TO authenticated;
GRANT ALL ON public.incident_escalations TO service_role;

ALTER TABLE public.incident_escalations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read escalations"
  ON public.incident_escalations FOR SELECT TO authenticated
  USING (is_org_member(auth.uid(), organisation_id));

CREATE POLICY "Leadership creates escalations"
  ON public.incident_escalations FOR INSERT TO authenticated
  WITH CHECK (
    has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin']::app_role[])
    AND created_by = auth.uid()
  );

CREATE POLICY "Leadership updates escalations"
  ON public.incident_escalations FOR UPDATE TO authenticated
  USING (has_org_role(auth.uid(), organisation_id, ARRAY['manager','supervisor','client_admin']::app_role[]));

-- Allow extra incident lifecycle status
ALTER TYPE incident_status ADD VALUE IF NOT EXISTS 'closed';

-- Realtime for live updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.incident_activity;
ALTER PUBLICATION supabase_realtime ADD TABLE public.incident_notes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.incident_escalations;
