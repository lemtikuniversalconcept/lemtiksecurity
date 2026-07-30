import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getActiveOrgId } from "@/lib/orgs.server";

type DashboardIncidentRow = {
  id: string;
  severity: number | null;
  status: string | null;
  zone: string | null;
  reported_at: string;
  type: string | null;
};

export const getDashboardAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();

    const { data: incidents } = await context.supabase
      .from("incidents")
      .select("id, severity, status, zone, reported_at, type")
      .eq("organisation_id", orgId)
      .gte("reported_at", thirtyDaysAgo)
      .order("reported_at", { ascending: true });

    const safeIncidents = (incidents ?? []) as DashboardIncidentRow[];

    const weeklyTrend = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const dayStr = d.toLocaleDateString("en-NG", { weekday: "short" });
      const dayIncidents = safeIncidents.filter((inc) => {
        const incDate = new Date(inc.reported_at);
        return incDate.toDateString() === d.toDateString();
      });
      return {
        day: dayStr,
        incidents: dayIncidents.length,
        resolved: dayIncidents.filter((inc) => ["resolved", "closed"].includes(String(inc.status))).length,
      };
    });

    const zoneMap = new Map<string, { total: number; weightedSeverity: number }>();
    for (const inc of safeIncidents) {
      const zone = inc.zone || "Unknown";
      const entry = zoneMap.get(zone) ?? { total: 0, weightedSeverity: 0 };
      entry.total += 1;
      entry.weightedSeverity += Number(inc.severity ?? 0);
      zoneMap.set(zone, entry);
    }
    const zoneRisk = Array.from(zoneMap.entries())
      .map(([zone, { total, weightedSeverity }]) => ({
        zone,
        score: Math.min(100, Math.round((weightedSeverity / Math.max(1, total)) * 20 + total * 2)),
        incidentCount: total,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    const totalIncidents = safeIncidents.length;
    const criticalIncidents = safeIncidents.filter((inc) => Number(inc.severity ?? 0) >= 4).length;
    const resolvedIncidents = safeIncidents.filter((inc) => ["resolved", "closed"].includes(String(inc.status))).length;
    const resolutionRate = totalIncidents > 0
      ? Math.round((resolvedIncidents / totalIncidents) * 100)
      : 0;

    return { weeklyTrend, zoneRisk, totalIncidents, criticalIncidents, resolutionRate };
  });
