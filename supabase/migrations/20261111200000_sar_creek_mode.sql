-- ============================================================
-- M2 (part): creek mode for search and rescue plans.
-- In creeks and rivers the drift follows the channel instead of spreading
-- across open water. The channel is copied from the voyage route or a
-- nearby corridor when creek mode is switched on, so the plan stays stable.
-- ============================================================

ALTER TABLE public.sar_cases
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'open_water',
  ADD COLUMN IF NOT EXISTS channel_route jsonb,
  ADD COLUMN IF NOT EXISTS channel_source text,
  ADD COLUMN IF NOT EXISTS channel_width_m integer NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS creek_flow text NOT NULL DEFAULT 'tidal';

ALTER TABLE public.sar_cases DROP CONSTRAINT IF EXISTS sar_cases_environment_check;
ALTER TABLE public.sar_cases ADD CONSTRAINT sar_cases_environment_check CHECK (environment IN ('open_water', 'creek'));
ALTER TABLE public.sar_cases DROP CONSTRAINT IF EXISTS sar_cases_channel_width_check;
ALTER TABLE public.sar_cases ADD CONSTRAINT sar_cases_channel_width_check CHECK (channel_width_m BETWEEN 5 AND 3000);
ALTER TABLE public.sar_cases DROP CONSTRAINT IF EXISTS sar_cases_creek_flow_check;
ALTER TABLE public.sar_cases ADD CONSTRAINT sar_cases_creek_flow_check CHECK (creek_flow IN ('toward_end', 'toward_start', 'tidal'));
ALTER TABLE public.sar_cases DROP CONSTRAINT IF EXISTS sar_cases_channel_source_check;
ALTER TABLE public.sar_cases ADD CONSTRAINT sar_cases_channel_source_check CHECK (channel_source IS NULL OR char_length(channel_source) <= 200);
ALTER TABLE public.sar_cases DROP CONSTRAINT IF EXISTS sar_cases_channel_route_check;
ALTER TABLE public.sar_cases ADD CONSTRAINT sar_cases_channel_route_check CHECK (channel_route IS NULL OR (jsonb_typeof(channel_route) = 'array' AND jsonb_array_length(channel_route) BETWEEN 2 AND 500));
