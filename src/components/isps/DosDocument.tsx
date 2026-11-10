import type { Declaration } from "@/lib/isps.functions";
import { FACILITY_KIND, LEVEL_LABEL } from "@/lib/isps.rules";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }) : "—");

/** The Declaration of Security as both parties see and sign it (ISPS Code, Part A section 5). */
export function DosDocument({ d }: { d: Omit<Declaration, "sign_url"> }) {
  const row = (k: string, v: React.ReactNode) => (
    <tr><th style={{ textAlign: "left", verticalAlign: "top", padding: "6px 10px 6px 0", width: "34%", fontWeight: 500, opacity: 0.75 }}>{k}</th><td style={{ padding: "6px 0", whiteSpace: "pre-wrap" }}>{v}</td></tr>
  );
  return (
    <article className="dos col g12" style={{ fontSize: 13.5, lineHeight: 1.5 }}>
      <header className="col g4">
        <span className="t3" style={{ fontSize: 11.5, letterSpacing: ".06em", textTransform: "uppercase" }}>Declaration of Security · ISPS Code</span>
        <h1 style={{ fontSize: 22, margin: 0 }}>{d.facility.name} and {d.ship_name}</h1>
        <span className="t3 mono" style={{ fontSize: 12 }}>{d.reference}</span>
      </header>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <tbody>
          {row(FACILITY_KIND[d.facility.kind] ?? "Port facility", `${d.facility.name}${d.facility.identifier ? ` (${d.facility.identifier})` : ""}\n${d.organisation}`)}
          {row("Ship", `${d.ship_name}${d.ship_imo ? ` · IMO ${d.ship_imo}` : ""}${d.ship_flag ? ` · flag ${d.ship_flag}` : ""}`)}
          {row("Security level", LEVEL_LABEL[d.security_level])}
          {row("Valid", `${when(d.valid_from)}\nto ${when(d.valid_to)}`)}
          {row("Activities covered", d.activities)}
          {row("Security measures agreed", d.measures)}
        </tbody>
      </table>
      <div className="grid g12" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <div className="pn" style={{ padding: 12 }}>
          <div className="t3" style={{ fontSize: 12 }}>For the port facility</div>
          <b>{d.port_signatory_name}</b>
          <div>{d.port_signatory_title}</div>
          <div className="t3" style={{ fontSize: 12 }}>Signed {when(d.port_signed_at)}</div>
        </div>
        <div className="pn" style={{ padding: 12 }}>
          <div className="t3" style={{ fontSize: 12 }}>For the ship</div>
          {d.ship_signed_at ? (<><b>{d.ship_signatory_name}</b><div>{d.ship_signatory_title}</div><div className="t3" style={{ fontSize: 12 }}>Signed {when(d.ship_signed_at)}</div></>) : <div className="t3">{d.status === "cancelled" ? "Cancelled before the ship signed" : "Not signed yet"}</div>}
        </div>
      </div>
      {d.status === "cancelled" && d.cancelled_reason && <div className="t2">Cancelled: {d.cancelled_reason}</div>}
      <footer className="t3" style={{ fontSize: 11.5 }}>
        Both parties agree to the measures above for the period stated. Content fingerprint (SHA-256): <span className="mono" style={{ wordBreak: "break-all" }}>{d.content_sha256}</span>. Signatures are electronic and recorded with the time in Lemtik SOD.
      </footer>
    </article>
  );
}
