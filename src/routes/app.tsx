import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/app")({
  head: () => ({ meta: [{ title: "Lemtik SOD — Operations" }] }),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/login" });
    }
    // Require an active organisation. If none, send to onboarding.
    const { data: profile } = await supabase
      .from("profiles")
      .select("active_organisation_id")
      .eq("user_id", data.user.id)
      .maybeSingle();
    if (!profile?.active_organisation_id) {
      throw redirect({ to: "/onboarding" });
    }
  },
  component: AppShell,
});
