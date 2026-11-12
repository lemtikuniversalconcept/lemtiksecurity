-- Cargo custody: who holds a consignment now, and the incident opened automatically when
-- seals don't match or a checkpoint is skipped.

ALTER TABLE public.cargo_consignments
  ADD COLUMN IF NOT EXISTS current_holder text CHECK (char_length(current_holder) <= 200),
  ADD COLUMN IF NOT EXISTS holder_since timestamptz,
  ADD COLUMN IF NOT EXISTS incident_id uuid REFERENCES public.incidents(id) ON DELETE SET NULL;

-- Existing consignments: the receiver of the last hand-over, else the carrier.
UPDATE public.cargo_consignments c SET
  current_holder = COALESCE(h.to_party, c.carrier),
  holder_since = COALESCE(h.recorded_at, c.created_at)
FROM (SELECT c2.id, (SELECT e.to_party FROM public.cargo_custody_events e WHERE e.consignment_id = c2.id AND e.kind = 'handover' AND e.to_party IS NOT NULL ORDER BY e.seq DESC LIMIT 1) AS to_party,
             (SELECT e.recorded_at FROM public.cargo_custody_events e WHERE e.consignment_id = c2.id AND e.kind = 'handover' AND e.to_party IS NOT NULL ORDER BY e.seq DESC LIMIT 1) AS recorded_at
      FROM public.cargo_consignments c2) h
WHERE h.id = c.id AND c.current_holder IS NULL;
