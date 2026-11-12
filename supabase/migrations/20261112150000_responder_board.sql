-- ============================================================
-- Responder board. A saved responder can be linked to the responder's own organisation on
-- Lemtik; hand-offs to that responder then also land on that organisation's board, where its
-- staff acknowledge and report progress in the app. A hand-off can now be sent through Lemtik
-- alone (channel 'lemtik'), with no phone call or WhatsApp.
-- ============================================================

ALTER TABLE public.movement_responders
  ADD COLUMN IF NOT EXISTS responder_org_id uuid REFERENCES public.organisations(id) ON DELETE SET NULL;

ALTER TABLE public.movement_handoffs
  ADD COLUMN IF NOT EXISTS responder_org_id uuid REFERENCES public.organisations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS movement_handoffs_responder_org_idx ON public.movement_handoffs (responder_org_id, created_at DESC) WHERE responder_org_id IS NOT NULL;

ALTER TABLE public.movement_handoffs DROP CONSTRAINT IF EXISTS movement_handoffs_channel_check;
ALTER TABLE public.movement_handoffs ADD CONSTRAINT movement_handoffs_channel_check CHECK (channel = ANY (ARRAY['call'::text, 'whatsapp'::text, 'lemtik'::text]));

ALTER TABLE public.movement_handoff_updates
  ADD COLUMN IF NOT EXISTS by_org_name text CHECK (by_org_name IS NULL OR char_length(by_org_name) <= 160);
