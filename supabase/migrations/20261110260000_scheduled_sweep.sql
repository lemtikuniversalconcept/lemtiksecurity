-- ============================================================
-- F1: run the alert checks every minute, whether or not anyone is logged in.
-- F5: maritime incident types.
--
-- Supabase Cron (pg_cron) calls the app's /api/cron/sweep endpoint every minute
-- through pg_net. The endpoint only runs when the request carries the shared
-- secret, which is kept in Supabase Vault (name: lemtik_cron_secret) and in the
-- app's CRON_SECRET environment variable. Until the secret is stored, the job
-- does nothing.
-- ============================================================

ALTER TYPE public.incident_type ADD VALUE IF NOT EXISTS 'man_overboard';
ALTER TYPE public.incident_type ADD VALUE IF NOT EXISTS 'capsize';
ALTER TYPE public.incident_type ADD VALUE IF NOT EXISTS 'collision';
ALTER TYPE public.incident_type ADD VALUE IF NOT EXISTS 'hijack';
ALTER TYPE public.incident_type ADD VALUE IF NOT EXISTS 'sea_robbery';
ALTER TYPE public.incident_type ADD VALUE IF NOT EXISTS 'boarding_attempt';
ALTER TYPE public.incident_type ADD VALUE IF NOT EXISTS 'crude_theft';
ALTER TYPE public.incident_type ADD VALUE IF NOT EXISTS 'cargo_theft';
ALTER TYPE public.incident_type ADD VALUE IF NOT EXISTS 'seal_tamper';
ALTER TYPE public.incident_type ADD VALUE IF NOT EXISTS 'stowaway';
ALTER TYPE public.incident_type ADD VALUE IF NOT EXISTS 'pollution_spill';
ALTER TYPE public.incident_type ADD VALUE IF NOT EXISTS 'drifting_vessel';

CREATE TABLE IF NOT EXISTS public.system_job_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job text NOT NULL,
  started_at timestamptz NOT NULL,
  duration_ms integer NOT NULL,
  orgs_checked integer NOT NULL DEFAULT 0,
  ok boolean NOT NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS system_job_runs_job_idx ON public.system_job_runs (job, started_at DESC);
ALTER TABLE public.system_job_runs ENABLE ROW LEVEL SECURITY;
-- No policies: written and read by the server only (platform System health).

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  PERFORM cron.unschedule('lemtik-sweep') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lemtik-sweep');
END $$;

SELECT cron.schedule(
  'lemtik-sweep',
  '* * * * *',
  $job$
    SELECT net.http_post(
      url := 'https://app.lemtik.com.ng/api/cron/sweep',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', s.decrypted_secret),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
    )
    FROM vault.decrypted_secrets s
    WHERE s.name = 'lemtik_cron_secret';
  $job$
);
