import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMemberDetail, getMemberActivity } from "@/lib/users.functions";
import { listLocations } from "@/lib/orgs.functions";
import { requireSectionAccess } from "@/lib/rbac";
import { ChevronLeft, Loader2 } from "lucide-react";
import { Avatar, Empty, Kpi, Notice, Panel, Sev, Status, Tag, timeAgo, type Tone } from "@/components/nw";

export const Route = createFileRoute("/app/users/$id")({
  head: () => ({ meta: [{ title: "Profile · Lemtik SOD" }] }),
  beforeLoad: async ({ context }) => {
    requireSectionAccess(context.appAccess, ["security_manager", "client_admin"]);
  },
  component: MemberPage,
});

const ROLE_LABEL: Record<string, string> = {
  officer: "Officer",
  supervisor: "Supervisor",
  manager: "Security manager",
  client_admin: "Client admin",
  security_forensic_analyst: "Forensic analyst",
  lemtik_admin: "Lemtik admin",
};
const DUTY: Record<string, { tone: Tone; label: string }> = {
  "on-duty": { tone: "ok", label: "On duty" },
  break: { tone: "warn", label: "On break" },
  "off-duty": { tone: "off", label: "Off duty" },
};
const CHECKIN_TONE: Record<string, "ok" | "warn" | "fail"> = { on_time: "ok", late: "warn", out_of_zone: "fail", too_fast: "fail", no_location: "warn" };

function MemberPage() {
  const { id } = Route.useParams();
  const detail = useServerFn(getMemberDetail);
  const activity = useServerFn(getMemberActivity);
  const locList = useServerFn(listLocations);

  const { data, isLoading, error } = useQuery({ queryKey: ["member", id], queryFn: () => detail({ data: { user_id: id } }) });
  const { data: act } = useQuery({ queryKey: ["member-activity", id], queryFn: () => activity({ data: { user_id: id } }) });
  const { data: locations = [] } = useQuery({ queryKey: ["org-locations"], queryFn: () => locList() });

  if (isLoading) {
    return (
      <Panel>
        <Empty>
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
        </Empty>
      </Panel>
    );
  }
  if (error) return <Notice tone="fail">{(error as Error).message}</Notice>;

  const p = data?.profile;
  const name = p?.display_name || data?.email || "Unnamed";
  const duty = DUTY[p?.status ?? "off-duty"] ?? DUTY["off-duty"];
  const assigned = (p?.assigned_location_ids ?? []).map((lid: string) => (locations as any[]).find((l) => l.id === lid)).filter(Boolean);
  const checkins = act?.checkins ?? [];
  const late = checkins.filter((c: any) => c.status && c.status !== "on_time").length;

  return (
    <div className="col g16">
      <Link to="/app/users" className="row g4 t3 lnk" style={{ fontSize: 12.5 }}>
        <ChevronLeft className="h-3.5 w-3.5" /> Team
      </Link>

      <section className="pn">
        <div className="row g16 wrap" style={{ padding: 18 }}>
          <span style={{ width: 56, height: 56, borderRadius: 28, overflow: "hidden", display: "grid", placeItems: "center" }}>
            {p?.photo_url ? <img src={p.photo_url} alt="" className="h-full w-full object-cover" /> : <Avatar name={name} size="lg" />}
          </span>
          <div className="col g4 f1" style={{ minWidth: 0 }}>
            <div className="row g8 wrap">
              <h1 className="ph1" style={{ margin: 0 }}>
                {name}
              </h1>
              {p?.is_active === false ? <Tag tone="fail">Deactivated</Tag> : <Status tone={duty.tone}>{duty.label}</Status>}
            </div>
            <span className="t2">
              {ROLE_LABEL[data?.membership?.role ?? ""] ?? data?.membership?.role ?? "Member"}
              {data?.email ? ` · ${data.email}` : ""}
              {p?.last_seen_at ? ` · last seen ${timeAgo(p.last_seen_at)}` : ""}
            </span>
          </div>
          <dl className="kv" style={{ minWidth: 260 }}>
            <dt>Phone</dt>
            <dd className="mono">{p?.phone || "—"}</dd>
            <dt>Employee ID</dt>
            <dd className="mono">{p?.employee_id || "—"}</dd>
            <dt>Zone</dt>
            <dd>{p?.zone || "—"}</dd>
            <dt>Joined</dt>
            <dd>{data?.membership?.created_at ? new Date(data.membership.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}</dd>
          </dl>
        </div>
        <div className="hr" />
        <div className="row g8 wrap" style={{ padding: "10px 18px" }}>
          <span className="t3" style={{ fontSize: 12 }}>
            Locations:
          </span>
          {assigned.length === 0 ? (
            <span className="t3" style={{ fontSize: 12 }}>
              None assigned
            </span>
          ) : (
            assigned.map((l: any) => (
              <span key={l.id} className="tg">
                {l.name}
              </span>
            ))
          )}
        </div>
      </section>

      <div className="kpis">
        <Kpi label="Incidents reported" value={act?.counts.incidents ?? "—"} />
        <Kpi label="Patrol check-ins" value={act?.counts.checkins ?? "—"} delta={checkins.length ? `${late} late or out of zone (recent)` : undefined} />
        <Kpi label="Notes written" value={act?.counts.notes ?? "—"} />
        <Kpi label="Audit events" value={act?.audit.length ?? "—"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Recent incidents reported" bodyClassName="">
          {(act?.incidents ?? []).length === 0 ? (
            <Empty>None yet.</Empty>
          ) : (
            <div className="list">
              {act!.incidents.slice(0, 10).map((i: any) => (
                <Link key={i.id} to="/app/incidents/$id" params={{ id: i.id }} className="row g10" style={{ padding: "9px 14px" }}>
                  {i.severity != null && <Sev level={i.severity} />}
                  <span className="mono">{i.code}</span>
                  <span className="t3 trunc f1">{i.location}</span>
                  <span className="t3" style={{ fontSize: 12 }}>
                    {String(i.status).replace(/_/g, " ")} · {timeAgo(i.reported_at)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Recent patrol check-ins" bodyClassName="">
          {checkins.length === 0 ? (
            <Empty>None yet.</Empty>
          ) : (
            <div className="list">
              {checkins.slice(0, 10).map((c: any) => (
                <div key={c.id} className="row g10" style={{ padding: "9px 14px" }}>
                  <Link to="/app/patrols/$id" params={{ id: c.patrol_id }} className="lnk mono f1 trunc" style={{ fontSize: 12 }}>
                    Route {String(c.patrol_id).slice(0, 8)}
                  </Link>
                  <span className="t3" style={{ fontSize: 12 }}>
                    {timeAgo(c.created_at)}
                  </span>
                  {c.status && <Tag tone={CHECKIN_TONE[c.status]}>{String(c.status).replace(/_/g, " ")}</Tag>}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Activity log" meta={act?.audit.length ? `${Math.min(30, act.audit.length)} most recent` : undefined} bodyClassName="">
        {(act?.audit ?? []).length === 0 ? (
          <Empty>No recorded activity.</Empty>
        ) : (
          <div className="list">
            {act!.audit.slice(0, 30).map((a: any) => (
              <div key={a.id} className="row g10" style={{ padding: "8px 14px", fontSize: 12.5 }}>
                <span className="mono f1 trunc">
                  {a.action}
                  <span className="t3"> · {a.entity}</span>
                </span>
                <span className="t3 mono" style={{ fontSize: 11 }}>
                  {new Date(a.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
