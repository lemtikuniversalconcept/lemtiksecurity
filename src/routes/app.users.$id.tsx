import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMemberDetail, getMemberActivity } from "@/lib/users.functions";
import { ArrowLeft, ShieldCheck, MapPin, Loader2, Activity, ClipboardList, Radar, FileText } from "lucide-react";

export const Route = createFileRoute("/app/users/$id")({
  head: () => ({ meta: [{ title: "Profile · Lemtik SOD" }] }),
  component: MemberPage,
});

function timeAgo(iso?: string | null) {
  if (!iso) return "—";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

function roleLabel(r: string) {
  return r.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function MemberPage() {
  const { id } = Route.useParams();
  const detail = useServerFn(getMemberDetail);
  const activity = useServerFn(getMemberActivity);

  const { data, isLoading, error } = useQuery({
    queryKey: ["member", id], queryFn: () => detail({ data: { user_id: id } }),
  });
  const { data: act } = useQuery({
    queryKey: ["member-activity", id], queryFn: () => activity({ data: { user_id: id } }),
  });

  if (isLoading) return <div className="p-10 text-center text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline" /> Loading…</div>;
  if (error) return <div className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-critical">{(error as Error).message}</div>;

  const p = data?.profile;
  const name = p?.display_name || "Operator";
  const initials = name.split(" ").map((n: string) => n[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="space-y-5">
      <Link to="/app/users" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3 w-3" /> Back to team
      </Link>

      <div className="rounded-lg border border-border bg-card p-5 flex items-start gap-4">
        <div className="grid h-14 w-14 place-items-center rounded-full bg-accent/20 border border-accent/40 text-sm font-bold text-accent overflow-hidden">
          {p?.photo_url ? <img src={p.photo_url} alt={name} className="h-full w-full object-cover" /> : initials}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{name}</h1>
            {p?.is_active === false && (
              <span className="rounded-md border border-critical/30 bg-critical/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-critical">Deactivated</span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> {roleLabel(data?.membership?.role ?? "officer")}</span>
            {p?.zone && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {p.zone}</span>}
            <span>Last seen {timeAgo(p?.last_seen_at)}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <Field label="Phone" value={p?.phone || "—"} />
            <Field label="Employee ID" value={p?.employee_id || "—"} />
            <Field label="Joined" value={data?.membership?.created_at ? new Date(data.membership.created_at).toLocaleDateString("en-GB") : "—"} />
            <Field label="Locations" value={String(p?.assigned_location_ids?.length ?? 0)} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon={ClipboardList} label="Incidents reported" value={act?.counts.incidents ?? 0} />
        <Stat icon={Radar} label="Patrol check-ins" value={act?.counts.checkins ?? 0} />
        <Stat icon={FileText} label="Notes authored" value={act?.counts.notes ?? 0} />
        <Stat icon={Activity} label="Audit events" value={act?.audit.length ?? 0} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Recent incidents reported">
          {(act?.incidents ?? []).length === 0 ? <Empty /> : (
            <ul className="divide-y divide-border">
              {act!.incidents.slice(0, 10).map((i) => (
                <li key={i.id} className="px-4 py-2.5 text-xs flex items-center justify-between gap-3">
                  <div className="min-w-0 truncate">
                    <div className="font-mono">{i.code}</div>
                    <div className="text-muted-foreground truncate">{i.location}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{i.status}</div>
                    <div className="text-[10px] text-muted-foreground">{timeAgo(i.reported_at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Recent patrol check-ins">
          {(act?.checkins ?? []).length === 0 ? <Empty /> : (
            <ul className="divide-y divide-border">
              {act!.checkins.slice(0, 10).map((c) => (
                <li key={c.id} className="px-4 py-2.5 text-xs flex items-center justify-between">
                  <div className="text-muted-foreground font-mono">{c.patrol_id.slice(0, 8)} · WP {c.waypoint_id?.slice(0, 6) ?? "—"}</div>
                  <div className="text-right">
                    <div className={`text-[10px] uppercase tracking-wider ${c.status === "on_time" ? "text-resolved" : c.status === "late" ? "text-high" : "text-critical"}`}>{c.status}</div>
                    <div className="text-[10px] text-muted-foreground">{timeAgo(c.created_at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Activity log" wide>
          {(act?.audit ?? []).length === 0 ? <Empty /> : (
            <ul className="divide-y divide-border">
              {act!.audit.slice(0, 30).map((a) => (
                <li key={a.id} className="px-4 py-2.5 text-xs flex items-center justify-between">
                  <div>
                    <span className="font-medium">{a.action}</span>
                    <span className="text-muted-foreground"> · {a.entity}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">{timeAgo(a.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-foreground truncate">{value}</div>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: any; label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function Panel({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`rounded-lg border border-border bg-card ${wide ? "lg:col-span-2" : ""}`}>
      <div className="px-4 py-3 border-b border-border text-sm font-medium">{title}</div>
      {children}
    </div>
  );
}

function Empty() {
  return <div className="px-4 py-8 text-center text-xs text-muted-foreground">No activity yet.</div>;
}
