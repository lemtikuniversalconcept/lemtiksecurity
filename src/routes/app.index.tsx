import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listIncidents } from "@/lib/incidents.functions";
import { listPatrols } from "@/lib/patrols.functions";
import { weeklyTrend, zoneRisk, type Severity, type IncidentStatus } from "@/lib/mockData";
import { SeverityBadge } from "@/components/SeverityBadge";
import { ArrowUpRight, Activity, ShieldAlert, Clock, MapPin, Radar } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeInvalidate } from "@/lib/useRealtime";

export const Route = createFileRoute("/app/")({
  head: () => ({ meta: [{ title: "Overview · Lemtik SOD" }] }),
  component: Overview,
});

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function Overview() {
  const lIncidents = useServerFn(listIncidents);
  const lPatrols = useServerFn(listPatrols);
  const [firstName, setFirstName] = useState("Operator");

  useRealtimeInvalidate("incidents", [["incidents"]]);
  useRealtimeInvalidate("patrols", [["patrols"]]);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: p } = await supabase.from("profiles").select("display_name").eq("user_id", data.user.id).maybeSingle();
      const n = (p?.display_name || data.user.email || "Operator").split(" ")[0];
      setFirstName(n);
    });
  }, []);

  const { data: incidents = [] } = useQuery({ queryKey: ["incidents"], queryFn: () => lIncidents() });
  const { data: patrols = [] } = useQuery({ queryKey: ["patrols"], queryFn: () => lPatrols() });

  const open = incidents.filter((i) => i.status !== "resolved");
  const critical = incidents.filter((i) => i.severity >= 4 && i.status !== "resolved").length;
  const patrolCompliance = patrols.length
    ? Math.round((patrols.reduce((acc, p) => acc + p.checked_in / Math.max(p.waypoints, 1), 0) / patrols.length) * 100)
    : 0;

  const max = Math.max(...weeklyTrend.map((w) => w.incidents));
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Operations Overview</div>
          <h1 className="mt-1 text-2xl font-semibold">{greeting}, {firstName}.</h1>
          <p className="text-sm text-muted-foreground">
            4 zones online · {open.length} active incidents · last sync just now
          </p>
        </div>
        <Link
          to="/app/incidents"
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          Log incident <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Open incidents" value={open.length.toString()} delta="live count" icon={ShieldAlert} tone="critical" />
        <Stat label="Critical (S4–S5)" value={critical.toString()} delta="needs attention" icon={Activity} tone="high" />
        <Stat label="Avg response" value="4m 12s" delta="−38s this week" icon={Clock} tone="resolved" />
        <Stat label="Patrol compliance" value={`${patrolCompliance}%`} delta={`${patrols.length} routes`} icon={Radar} tone="muted" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-sm font-medium">Incident volume — last 7 days</div>
              <div className="text-xs text-muted-foreground">Reported vs resolved · all zones</div>
            </div>
            <span className="text-[11px] font-mono text-muted-foreground">trend</span>
          </div>
          <div className="flex items-end gap-3 h-44">
            {weeklyTrend.map((d) => (
              <div key={d.day} className="flex-1 flex flex-col items-center gap-2">
                <div className="w-full flex items-end justify-center gap-1 h-36">
                  <div className="w-3 rounded-t bg-primary/70" style={{ height: `${(d.incidents / max) * 100}%` }} />
                  <div className="w-3 rounded-t bg-accent/70" style={{ height: `${(d.resolved / max) * 100}%` }} />
                </div>
                <div className="text-[10px] font-mono text-muted-foreground">{d.day}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-4 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-primary/70" /> Reported</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-accent/70" /> Resolved</span>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <div className="text-sm font-medium mb-1">Zone risk score</div>
          <div className="text-xs text-muted-foreground mb-4">Composite 7-day index</div>
          <div className="space-y-3">
            {zoneRisk.map((z) => (
              <div key={z.zone}>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="font-medium">{z.zone}</span>
                  <span className="font-mono text-muted-foreground">{z.score} · {z.trend}</span>
                </div>
                <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${z.score}%`,
                      background: z.score > 65 ? "var(--critical)" : z.score > 50 ? "var(--high)" : "var(--resolved)",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="text-sm font-medium">Active incidents</div>
            <Link to="/app/incidents" className="text-[11px] text-muted-foreground hover:text-foreground">View all →</Link>
          </div>
          {open.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-muted-foreground">No active incidents. All clear.</div>
          ) : (
            <ul className="divide-y divide-border">
              {open.slice(0, 5).map((i) => (
                <li key={i.id} className="px-5 py-3 flex items-center gap-3">
                  <SeverityBadge severity={i.severity as Severity} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{i.code} · {i.location}</div>
                    <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                      <MapPin className="h-3 w-3" /> {i.zone} · {timeAgo(i.reported_at)}
                    </div>
                  </div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{i.status as IncidentStatus}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="text-sm font-medium">Patrols on shift</div>
            <Link to="/app/patrols" className="text-[11px] text-muted-foreground hover:text-foreground">View all →</Link>
          </div>
          {patrols.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-muted-foreground">No patrols scheduled yet.</div>
          ) : (
            <ul className="divide-y divide-border">
              {patrols.map((p) => (
                <li key={p.id} className="px-5 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{p.name}</div>
                    <div className="text-[11px] text-muted-foreground">{p.officer} · {p.shift}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-mono">{p.checked_in}/{p.waypoints}</div>
                    <div className={`text-[10px] uppercase tracking-wider font-medium ${
                      p.status === "missed" ? "text-critical" :
                      p.status === "delayed" ? "text-high" :
                      p.status === "complete" ? "text-resolved" : "text-muted-foreground"
                    }`}>{p.status.replace("_", " ")}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, delta, icon: Icon, tone }: {
  label: string; value: string; delta: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "critical" | "high" | "resolved" | "muted";
}) {
  const toneClass = {
    critical: "text-critical bg-critical/10 border-critical/30",
    high: "text-high bg-high/10 border-high/30",
    resolved: "text-resolved bg-resolved/10 border-resolved/30",
    muted: "text-muted-foreground bg-muted border-border",
  }[tone];
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={`grid h-7 w-7 place-items-center rounded-md border ${toneClass}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{delta}</div>
    </div>
  );
}
