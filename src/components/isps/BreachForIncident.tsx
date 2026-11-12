import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Anchor } from "lucide-react";
import { Status } from "@/components/nw";
import { getBreachesForIncident } from "@/lib/isps.functions";
import { BREACH_LABEL } from "@/lib/isps.rules";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

/** On an incident page: the ISPS breach register entries recorded against this incident. */
export function BreachForIncident({ incidentId }: { incidentId: string }) {
  const fn = useServerFn(getBreachesForIncident);
  const q = useQuery({ queryKey: ["isps-breach-for-incident", incidentId], queryFn: () => fn({ data: { incident_id: incidentId } }), staleTime: 60_000 });
  if (!q.data?.length) return null;
  return (
    <div className="card col g6" style={{ padding: "10px 12px", fontSize: 13 }}>
      {q.data.map((b) => (
        <div key={b.id} className="row g8 wrap" style={{ alignItems: "center" }}>
          <Anchor size={14} />
          <b>ISPS breach register:</b>
          <span>{BREACH_LABEL[b.category] ?? b.category} at {b.facility}</span>
          <span className="t3">{when(b.occurred_at)}{b.security_level ? ` · level ${b.security_level}` : ""}</span>
          <Status tone={b.status === "open" ? "fail" : "off"}>{b.status === "open" ? "Open" : "Closed"}</Status>
          {b.reported_to_authority ? <Status tone="ok">Reported to {b.reported_to}</Status> : <Status tone="warn">Not reported to the authority</Status>}
          <span className="f1" />
          <Link to="/app/isps" className="b b-sm b-gh">Open breach register</Link>
        </div>
      ))}
    </div>
  );
}
