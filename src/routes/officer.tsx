import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { resolveAppAccess, requireSectionAccess } from "@/lib/rbac";
import { OfficerShell } from "@/components/OfficerShell";

export const Route = createFileRoute("/officer")({
  beforeLoad: async ({ location }) => {
    requireSectionAccess(await resolveAppAccess(supabase, location.href), ["field_officer"]);
  },
  component: OfficerLayout,
});

function OfficerLayout() {
  return <OfficerShell />;
}
