import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { resolveAppAccess } from "@/lib/rbac";

export const Route = createFileRoute("/app")({
  head: () => ({ meta: [{ title: "Lemtik SOD — Operations" }] }),
  beforeLoad: async () => {
    const appAccess = await resolveAppAccess(supabase);
    if (appAccess.specRole === "field_officer") {
      throw redirect({ to: "/officer/home" });
    }
    return { appAccess };
  },
  component: AppRouteShell,
});

function AppRouteShell() {
  const { appAccess } = Route.useRouteContext();
  return <AppShell access={appAccess} />;
}
