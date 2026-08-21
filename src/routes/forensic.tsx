import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { resolveAppAccess, requireSectionAccess } from "@/lib/rbac";
import { ForensicShell } from "@/components/ForensicShell";

export const Route = createFileRoute("/forensic")({
  head: () => ({ meta: [{ title: "Forensic Review · Lemtik SOD" }] }),
  beforeLoad: async ({ location }) => {
    requireSectionAccess(await resolveAppAccess(supabase, location.href), ["security_forensic_analyst"]);
  },
  component: ForensicShell,
});
