import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Loader2, Megaphone } from "lucide-react";
import { createReportLink, getReportLink, revokeReportLink } from "@/lib/telegram-reports.functions";

/** Managers: the public Telegram link community members use to send reports, with a QR code for posters. */
export function TelegramReportsCard() {
  const qc = useQueryClient();
  const getFn = useServerFn(getReportLink);
  const createFn = useServerFn(createReportLink);
  const revokeFn = useServerFn(revokeReportLink);
  const q = useQuery({ queryKey: ["telegram-report-link"], queryFn: () => getFn(), retry: false });
  const [limit, setLimit] = useState(10);
  const [qr, setQr] = useState<string | null>(null);
  const url = q.data?.link?.url ?? "";
  useEffect(() => {
    let live = true;
    setQr(null);
    if (url) import("qrcode").then((Q) => Q.default.toDataURL(url, { width: 480, margin: 1 })).then((u) => live && setQr(u)).catch(() => null);
    return () => { live = false; };
  }, [url]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["telegram-report-link"] });
  const create = useMutation({ mutationFn: () => createFn({ data: { label: null, daily_limit: limit } }), onSuccess: () => { toast.success("Report link ready"); refresh(); }, onError: (e) => toast.error((e as Error).message) });
  const revoke = useMutation({ mutationFn: () => revokeFn(), onSuccess: () => { toast.success("Report link turned off"); refresh(); }, onError: (e) => toast.error((e as Error).message) });
  const d = q.data;
  if (!d) return null;
  return (
    <div className="card col g10" style={{ padding: "10px 12px" }}>
      <div className="row g10 wrap" style={{ alignItems: "center" }}>
        <Megaphone size={16} />
        <span className="col f1" style={{ minWidth: 0 }}>
          <b>Reports by Telegram</b>
          <span className="t3" style={{ fontSize: 12 }}>
            Anyone on your team with a linked Telegram can send <code>/report</code> to the bot to open an incident with photos and a location.
            {" "}For the community (boat drivers, fishermen, jetty marshals), share the link below. Their reports come in as unverified, internal incidents, and they're known to you only as "Reporter #1", "#2" and so on.
          </span>
        </span>
      </div>
      {!d.configured ? <span className="t3" style={{ fontSize: 12 }}>Telegram isn't set up on this system yet.</span> : (
        <>
          <span className="t3" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
            Last 30 days: {d.staff_reports_30d} team report{d.staff_reports_30d === 1 ? "" : "s"} · {d.reports_30d} community report{d.reports_30d === 1 ? "" : "s"} · {d.reporters} community reporter{d.reporters === 1 ? "" : "s"}{d.blocked ? ` (${d.blocked} blocked)` : ""}
          </span>
          {d.link ? (
            <div className="row g12 wrap" style={{ alignItems: "flex-start" }}>
              {qr && <a href={qr} download="lemtik-telegram-report-qr.png" title="Download the QR code for a poster"><img src={qr} alt="QR code that opens the Telegram report bot" width={140} height={140} style={{ background: "#fff", padding: 6, borderRadius: 6 }} /></a>}
              <div className="col g6 f1" style={{ minWidth: 220, fontSize: 12.5 }}>
                <span className="row g6" style={{ alignItems: "center", flexWrap: "wrap" }}>
                  <code className="mono" style={{ padding: "4px 8px", borderRadius: 6, background: "var(--bg-2, rgba(127,127,127,.12))", wordBreak: "break-all" }}>{d.link.url}</code>
                  <button type="button" className="b b-sm b-gh" onClick={() => navigator.clipboard?.writeText(d.link!.url).then(() => toast.success("Copied"), () => null)}><Copy size={12} /> Copy</button>
                </span>
                <span className="t3">Up to {d.link.daily_limit} reports a day from each reporter. Created {new Date(d.link.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}{d.link.created_by_name ? ` by ${d.link.created_by_name}` : ""}. Click the QR code to download it for a poster.</span>
                {d.can_manage && (
                  <span className="row g6 wrap">
                    <button type="button" className="b b-sm b-sec" disabled={create.isPending} onClick={() => create.mutate()} title="The current link and QR code stop working">Replace link</button>
                    <button type="button" className="b b-sm b-gh" disabled={revoke.isPending} onClick={() => revoke.mutate()}>Turn off</button>
                  </span>
                )}
              </div>
            </div>
          ) : d.can_manage ? (
            <div className="row g8 wrap" style={{ alignItems: "center", fontSize: 12.5 }}>
              <label className="row g6" style={{ alignItems: "center" }}>
                <span className="lbl">Reports a day per reporter</span>
                <input className="in" style={{ width: 70 }} inputMode="numeric" value={limit} onChange={(e) => setLimit(Math.max(1, Math.min(100, Number(e.target.value.replace(/\D/g, "")) || 1)))} />
              </label>
              <button type="button" className="b b-sm b-pri" disabled={create.isPending} onClick={() => create.mutate()}>{create.isPending && <Loader2 size={13} className="animate-spin" />} Create community report link</button>
            </div>
          ) : <span className="t3" style={{ fontSize: 12 }}>No community report link. A manager can create one.</span>}
        </>
      )}
    </div>
  );
}
