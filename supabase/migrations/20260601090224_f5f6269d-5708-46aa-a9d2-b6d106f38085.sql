-- Fix: allow creator to SELECT the org they just created (before membership row exists).
CREATE POLICY "Creator reads own org"
ON public.organisations FOR SELECT
TO authenticated
USING (created_by = auth.uid());

-- Helper for assigning incident to current user (officer text field).
-- (No schema change needed; handled in code.)
