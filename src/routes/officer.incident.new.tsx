import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, ChevronLeft, CloudOff } from "lucide-react";
import { createIncident } from "@/lib/incidents.functions";
import { getActiveOrg, listLocations } from "@/lib/orgs.functions";
import * as offline from "@/lib/offlineQueue";
import { IncidentReportForm, type IncidentSubmitPayload } from "@/components/IncidentReportForm";
import { NetPill, useOnline } from "@/components/officer/kit";

export const Route = createFileRoute("/officer/incident/new")({
  component: NewIncident,
});

function NewIncident() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const online = useOnline();
  const create = useServerFn(createIncident);
  const fetchActiveOrg = useServerFn(getActiveOrg);
  const fetchLocations = useServerFn(listLocations);
  const [done, setDone] = useState<null | { offline: boolean; code?: string; id?: string }>(null);
  const [formKey, setFormKey] = useState(0);

  const { data: org } = useQuery({ queryKey: ["officer-active-org"], queryFn: () => fetchActiveOrg() });
  const { data: locations = [] } = useQuery({ queryKey: ["officer-saved-locations"], queryFn: () => fetchLocations(), enabled: !!org });

  // Send anything saved offline as soon as the connection returns.
  useEffect(() => {
    if (!online) return;
    offline
      .flush((payload) => create({ data: payload }) as Promise<unknown>)
      .then((sent) => {
        if (sent > 0) void qc.invalidateQueries({ queryKey: ["incidents"] });
      })
      .catch(() => undefined);
  }, [online, create, qc]);

  const submit = useMutation({
    mutationFn: async (payload: IncidentSubmitPayload) => {
      if (!navigator.onLine) {
        offline.enqueue(payload);
        return { offline: true } as const;
      }
      const row = (await create({ data: payload })) as any;
      return { offline: false, code: row?.code as string | undefined, id: row?.id as string | undefined } as const;
    },
    onSuccess: (r) => {
      setDone(r);
      qc.invalidateQueries({ queryKey: ["incidents"] });
      qc.invalidateQueries({ queryKey: ["officer-incidents"] });
    },
  });

  const header = (
    <div className="o-h">
      <Link to="/officer/home" className="ibtn" aria-label="Back">
        <ChevronLeft size={18} />
      </Link>
      <h1 className="f1">Report</h1>
      <NetPill />
    </div>
  );

  if (done) {
    return (
      <>
        {header}
        <div className="o-b" style={{ alignItems: "center", textAlign: "center", paddingTop: 40 }}>
          {done.offline ? <CloudOff size={48} style={{ color: "var(--warn)" }} /> : <CheckCircle2 size={48} style={{ color: "var(--ok)" }} />}
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{done.offline ? "Saved on this phone" : "Report sent"}</h2>
          <p className="t2" style={{ margin: 0, maxWidth: 320 }}>
            {done.offline ? "It sends automatically when you're back online. If it's urgent, use the radio now." : `Command can see it now${done.code ? ` as ${done.code}` : ""}.`}
          </p>
          <div className="col g10" style={{ width: "100%", marginTop: 12 }}>
            {done.id && (
              <Link to="/officer/incident/$id" params={{ id: done.id }} className="bigbtn" style={{ background: "var(--ink-2)", color: "var(--tx-1)", borderColor: "var(--line-2)" }}>
                View the report
              </Link>
            )}
            <button
              type="button"
              className="bigbtn"
              style={{ background: "var(--blue)", color: "#fff" }}
              onClick={() => {
                setDone(null);
                setFormKey((k) => k + 1);
              }}
            >
              Report something else
            </button>
            <button type="button" className="b b-gh" style={{ alignSelf: "center" }} onClick={() => navigate({ to: "/officer/home" })}>
              Back to home
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {header}
      <div className="o-b">
        {!org ? (
          <div className="o-card t3">Loading…</div>
        ) : (
          <IncidentReportForm
            key={formKey}
            organisationId={org.id}
            savedLocations={locations as any[]}
            defaultZone={(locations as any[])[0]?.name || org.name || "Unspecified"}
            onSubmit={(payload) => submit.mutate(payload)}
            loading={submit.isPending}
            error={submit.error instanceof Error ? submit.error.message : null}
            onClose={() => navigate({ to: "/officer/home" })}
            online={online}
          />
        )}
      </div>
    </>
  );
}
