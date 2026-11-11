-- ============================================================
-- Per-organisation module switches, set by Lemtik staff (so modules can be sold as add-ons).
-- NULL means "the defaults for this organisation type", which is exactly what each type
-- saw before this change. Otherwise only the listed modules are on.
-- ============================================================
ALTER TABLE public.organisations ADD COLUMN IF NOT EXISTS features text[];
ALTER TABLE public.organisations DROP CONSTRAINT IF EXISTS organisations_features_check;
ALTER TABLE public.organisations ADD CONSTRAINT organisations_features_check
  CHECK (features IS NULL OR features <@ ARRAY['movement','corridors','sar','isps','cargo','links']::text[]);
