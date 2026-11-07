import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight } from "lucide-react";
import { getOpenIncidentSummary } from "@/lib/incidents.functions";
import { useRealtimeInvalidate } from "@/lib/useRealtime";
import { useUrgentConsumerIncidents } from "@/components/ConsumerEmergencyAlert";
import { typeMeta, type IncidentType } from "@/lib/mockData";
import { elapsed } from "@/components/nw";

export function useOpenIncidentSummary(enabled = true) {
  const load = useServerFn(getOpenIncidentSummary);
  useRealtimeInvalidate("incidents", [["open-incident-summary"]]);
  return useQuery({ queryKey: ["open-incident-summary"], queryFn: () => load(), enabled, refetchInterval: 60_000 });
}

function useTick(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

/** The one bar that is allowed to shout: unacknowledged guest SOS first, then the open S5. */
export function PriorityBar({ orgId }: { orgId: string }) {
  const guest = useUrgentConsumerIncidents(orgId);
  const { data } = useOpenIncidentSummary();
  const top = data?.top ?? null;
  const critical = top && Number(top.severity) >= 5 ? top : null;
  const now = useTick(guest.length > 0 || critical !== null);

  if (guest.length > 0) {
    const first = guest[0];
    return (
      <div className="prio" role="alert">
        <span className="pulse red pulse-dot" aria-hidden="true" />
        <span className="tag">GUEST SOS</span>
        <span style={{ fontWeight: 600 }}>
          {guest.length === 1 ? "A guest is asking for help" : `${guest.length} guests are asking for help`} · {first.code}
          {first.title ? ` · ${first.title}` : ""}
        </span>
        <span className="mono" style={{ color: "#FFB1B2" }}>waiting {elapsed(first.reported_at, now)}</span>
        <span className="flex-auto" />
        <Link to="/app/incidents/$id" params={{ id: first.id }} className="b b-sm b-red">
          Open {guest.length === 1 ? "report" : "first report"}
          <ArrowRight size={13} strokeWidth={2} className="ic" />
        </Link>
      </div>
    );
  }

  if (!critical) return null;
  const place = [critical.zone, critical.location].filter(Boolean).join(", ");
  const what = critical.title || typeMeta[critical.type as IncidentType] || "Incident";
  return (
    <div className="prio" role="alert">
      <span className="tag">S5 CRITICAL</span>
      <span style={{ fontWeight: 600 }} className="trunc">
        {critical.code} · {what}
        {place ? ` · ${place}` : ""}
      </span>
      <span className="mono" style={{ color: "#FFB1B2" }}>open {elapsed(critical.reported_at, now)}</span>
      <span className="flex-auto" />
      <Link to="/app/incidents/$id" params={{ id: critical.id }} className="b b-sm b-red">
        Open response
        <ArrowRight size={13} strokeWidth={2} className="ic" />
      </Link>
    </div>
  );
}
