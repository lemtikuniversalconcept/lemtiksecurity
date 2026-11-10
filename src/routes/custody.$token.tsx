import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Loader2, Package } from "lucide-react";
import { LemtikMark, Notice } from "@/components/nw";
import { CustodyRecorder, CUSTODY_KIND } from "@/components/cargo/Recorder";
import { driverRecordCustody, driverUploadUrl, getDriverConsignment } from "@/lib/cargo.functions";

/** Driver or captain page: record handovers, checkpoints and delivery with photos or clips, no account needed. */
export const Route = createFileRoute("/custody/$token")({
  head: () => ({ meta: [{ title: "Cargo custody · Lemtik" }, { name: "robots", content: "noindex" }, { name: "theme-color", content: "#0A0C10" }] }),
  component: DriverPage,
});

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const NAME_KEY = "lemtik.custody.driver";

function DriverPage() {
  const { token } = Route.useParams();
  const infoFn = useServerFn(getDriverConsignment);
  const upFn = useServerFn(driverUploadUrl);
  const recFn = useServerFn(driverRecordCustody);
  const q = useQuery({ queryKey: ["custody-driver", token], queryFn: () => infoFn({ data: { token } }), retry: false });
  const [name, setName] = useState("");
  useEffect(() => {
    try { setName(localStorage.getItem(NAME_KEY) ?? ""); } catch { /* storage unavailable */ }
  }, []);
  const saveName = (v: string) => {
    setName(v);
    try { localStorage.setItem(NAME_KEY, v); } catch { /* storage unavailable */ }
  };
  const i = q.data;

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg, #0A0C10)", padding: "20px 16px" }}>
      <div className="col g16" style={{ maxWidth: 560, margin: "0 auto" }}>
        <div className="row g8" style={{ alignItems: "center" }}><LemtikMark /><span className="t3" style={{ fontSize: 12 }}>Cargo custody</span></div>
        {q.isLoading ? <span className="row g8 t3"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</span>
          : !i?.found ? <Notice tone="fail">This link isn't valid any more. Ask the operator for a new one.</Notice>
          : (
            <>
              <div className="pn col g4" style={{ padding: 14 }}>
                <span className="row g8" style={{ alignItems: "center" }}><Package size={16} /><b className="mono">{i.reference}</b></span>
                <span>{i.description}</span>
                <span className="t3" style={{ fontSize: 13 }}>{i.origin} → {i.destination} · for {i.operator}</span>
              </div>
              {i.status === "delivered" ? <Notice tone="ok">This cargo has been delivered. Thank you.</Notice> : (
                <div className="pn" style={{ padding: 14 }}>
                  <CustodyRecorder
                    kinds={["loaded", "departed", "checkpoint", "handover", "inspection", "delivered", "exception"].filter((k) => k !== "checkpoint" || i.checkpoints.length > 0)}
                    checkpoints={i.checkpoints}
                    sealCount={i.seal_count}
                    getUploadUrl={(f) => upFn({ data: { token, ...f, type: f.type as any } })}
                    onSubmit={(input) => {
                      if (name.trim().length < 2) return Promise.reject(new Error("Enter your name first."));
                      return recFn({ data: { token, driver_name: name.trim(), ...input, kind: input.kind as any } });
                    }}
                    onDone={() => q.refetch()}
                    extra={<label className="fl"><span>Your name</span><input className="in" value={name} onChange={(e) => saveName(e.target.value)} maxLength={80} autoComplete="name" required /></label>}
                  />
                </div>
              )}
              {i.events.length > 0 && (
                <div className="col g4" style={{ fontSize: 13 }}>
                  <b>Recorded so far</b>
                  {i.events.map((e) => <span key={e.seq} className="t2">#{e.seq} · {CUSTODY_KIND[e.kind] ?? e.kind}{e.kind === "checkpoint" && e.checkpoint_index != null ? `: ${i.checkpoints[e.checkpoint_index] ?? ""}` : ""} · {when(e.recorded_at)} · {e.recorded_by_name}</span>)}
                </div>
              )}
              <p className="t3" style={{ fontSize: 12 }}>Your name, the time, your phone's location and the photos or clips you add are sent to {i.operator} as a record of the cargo's journey. Nothing else is collected.</p>
            </>
          )}
      </div>
    </main>
  );
}
