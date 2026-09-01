ALTER TABLE public.organisation_settings
  ADD COLUMN IF NOT EXISTS automation_mode SMALLINT NOT NULL DEFAULT 1
    CHECK (automation_mode BETWEEN 0 AND 3);

COMMENT ON COLUMN public.organisation_settings.automation_mode IS
  'Autonomous Controller policy tier: 0=advisory_only, 1=human_approval (default), 2=policy_automation (low-risk allowlisted actions like camera/sensor control run without a human signature), 3=emergency_response.';
