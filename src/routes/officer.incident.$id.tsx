import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, Loader2, Send } from "lucide-react";
import { addIncidentNote, getIncidentDetail } from "@/lib/incidentDetail.functions";
import { typeMeta, type IncidentType } from "@/lib/mockData";
import { Lifecycle, Notice, Sev, Tabs, timeAgo } from "@/components/nw";
import { NetPill, useOnline } from "@/components/officer/kit";

type Tab = "overview" | "activity" | "evidence";

export const Route = createFileRoute("/officer/incident/$id")({
  component: OfficerIncidentDetail,
});

function OfficerIncidentDetail() {
  const { id } = Route.useParams() as { id: string };
  const qc = useQueryClient();
  const online = useOnline();
  const getDetail = useServerFn(getIncidentDetail);
  const addNote = useServerFn(addIncidentNote);
  const [tab, setTab] = useState<Tab>("overview");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "fail"; text: string } | null>(null);

  const { data, isLoading, error } = useQuery({ queryKey: ["officer-incident-detail", id], queryFn: () => getDetail({ data: { id } }) as Promise<any> });

  const header = (title: string, code?: string) => (
    <div className="o-h">
      <Link to="/officer/notifications" className="ibtn" aria-label="Back">
        <ChevronLeft size={18} />
      </Link>
      <div className="col f1" style={{ minWidth: 0 }}>
        {code ? <span className="mono t3">{code}</span> : null}
        <h1 className="trunc">{title}</h1>
      </div>
      <NetPill />
    </div>
  );

  if (isLoading) return <>{header("Incident")}<div className="o-b t3">Loading…</div></>;
  if (error || !data) {
    return (
      <>
        {header("Incident")}
        <div className="o-b">
          <Notice tone="fail">This incident couldn't be loaded{online ? "" : " while you're offline"}.</Notice>
        </div>
      </>
    );
  }

  const incident = data.incident as any;
  const activity = ((data.activity as any[]) ?? []).slice().reverse();
  const evidence = Array.isArray(incident.evidence) ? incident.evidence : [];

  const send = async () => {
    if (!note.trim()) return;
    setSending(true);
    setMsg(null);
    try {
      await addNote({ data: { incident_id: id, body: note.trim() } });
      setNote("");
      setMsg({ tone: "ok", text: "Update added. Command can see it." });
      qc.invalidateQueries({ queryKey: ["officer-incident-detail", id] });
    } catch (e) {
      setMsg({ tone: "fail", text: (e as Error)?.message || "The update didn't send." });
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {header(incident.title || typeMeta[incident.type as IncidentType] || "Incident", incident.code)}
      <div className="o-b">
        <div className="row g8 wrap">
          <Sev level={incident.severity} label />
          <Lifecycle status={incident.status} />
          <span className="t3" style={{ fontSize: 12 }}>
            reported {timeAgo(incident.reported_at)}
          </span>
        </div>

        <Tabs
          label="Incident sections"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "overview", label: "Overview" },
            { value: "activity", label: "Activity", count: activity.length },
            { value: "evidence", label: "Evidence", count: evidence.length },
          ]}
        />

        {tab === "overview" && (
          <>
            <div className="o-card col g8">
              <span className="o-lbl">WHERE</span>
              <b>{incident.location || "Not given"}</b>
              <span className="t2">
                {incident.zone || ""}
                {incident.floor ? ` · floor ${incident.floor}` : ""}
              </span>
              {incident.coord_x != null && incident.coord_y != null && (
                <span className="mono t3" style={{ fontSize: 12 }}>
                  {Number(incident.coord_y).toFixed(5)}, {Number(incident.coord_x).toFixed(5)}
                </span>
              )}
            </div>
            <div className="o-card col g8">
              <span className="o-lbl">WHAT WAS REPORTED</span>
              <p style={{ margin: 0, whiteSpace: "pre-line", lineHeight: 1.55 }}>{incident.description || "No description."}</p>
              {incident.suspect_count != null && incident.suspect_count > 0 && (
                <span className="t2">
                  {incident.suspect_count} suspect{incident.suspect_count === 1 ? "" : "s"}
                  {incident.suspect_description ? `: ${incident.suspect_description}` : ""}
                </span>
              )}
              <span className="t3" style={{ fontSize: 12.5 }}>
                Assigned: {incident.officer || "nobody yet"}
              </span>
            </div>
            <div className="o-card col g8">
              <span className="o-lbl">ADD AN UPDATE</span>
              <textarea className="in" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What's happening now?" style={{ height: "auto", paddingTop: 8 }} />
              {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
              <button type="button" className="b b-pri" onClick={() => void send()} disabled={sending || !note.trim() || !online} style={{ alignSelf: "flex-start" }}>
                {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} {online ? "Send update" : "Needs a connection"}
              </button>
            </div>
          </>
        )}

        {tab === "activity" && (
          <div className="o-card list" style={{ padding: 0 }}>
            {activity.length === 0 ? (
              <div className="t3" style={{ padding: 14 }}>
                Nothing yet.
              </div>
            ) : (
              activity.map((a: any) => (
                <div key={a.id} className="col" style={{ padding: "10px 14px" }}>
                  <span style={{ fontSize: 13.5 }}>{a.message}</span>
                  <span className="t3" style={{ fontSize: 11.5 }}>
                    {a.actor_name ? `${a.actor_name} · ` : ""}
                    {new Date(a.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))
            )}
          </div>
        )}

        {tab === "evidence" && (
          <div className="col g8">
            {evidence.length === 0 ? (
              <div className="o-card t3">No evidence attached.</div>
            ) : (
              evidence.map((e: any, i: number) => (
                <div key={`${e.path}-${i}`} className="o-card row g10">
                  <span className="tg">{e.kind}</span>
                  <span className="f1 trunc">{e.name}</span>
                  {e.legal ? <span className="tg tg-fail">Legal hold</span> : null}
                  {e.url ? (
                    <a href={e.url} target="_blank" rel="noreferrer noopener" className="b b-sm b-gh">
                      Open
                    </a>
                  ) : null}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </>
  );
}
