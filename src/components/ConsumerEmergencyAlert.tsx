import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type UrgentIncident = { id: string; code: string; title: string | null; reported_at: string };

function beep() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
    osc.onended = () => ctx.close();
  } catch {
    // Web Audio unavailable — the visual flash still carries the alert.
  }
}

// A guest holding the emergency button needs to reach an operator's attention
// immediately, not whenever someone next happens to check the incidents list — this
// polls + subscribes in real time, flashes the sidebar, and sounds an alert (repeating
// while the tab isn't even focused) until every unacknowledged one is opened.
export function useUrgentConsumerIncidents(orgId: string | null | undefined) {
  const [incidents, setIncidents] = useState<UrgentIncident[]>([]);
  const prevIdsRef = useRef<Set<string>>(new Set());
  const repeatTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;

    const load = async () => {
      const { data } = await supabase
        .from("incidents" as any)
        .select("id, code, title, reported_at")
        .eq("organisation_id", orgId)
        .eq("source", "consumer_pwa")
        .is("acknowledged_at", null)
        .order("reported_at", { ascending: false });
      if (cancelled) return;
      const next = (data as unknown as UrgentIncident[]) || [];
      const nextIds = new Set(next.map((i) => i.id));
      const hasNew = [...nextIds].some((id) => !prevIdsRef.current.has(id));
      if (hasNew) beep();
      prevIdsRef.current = nextIds;
      setIncidents(next);
    };

    load();
    const channel = supabase
      .channel(`urgent-consumer-incidents-${orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "incidents", filter: `organisation_id=eq.${orgId}` }, load)
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [orgId]);

  useEffect(() => {
    if (repeatTimerRef.current) window.clearInterval(repeatTimerRef.current);
    if (incidents.length === 0) return;
    repeatTimerRef.current = window.setInterval(() => {
      if (document.hidden) beep();
    }, 15000);
    return () => {
      if (repeatTimerRef.current) window.clearInterval(repeatTimerRef.current);
    };
  }, [incidents.length]);

  return incidents;
}

export function ConsumerEmergencyAlert({ orgId }: { orgId: string | null | undefined }) {
  const incidents = useUrgentConsumerIncidents(orgId);
  const navigate = useNavigate();
  if (incidents.length === 0) return null;

  return (
    <button
      type="button"
      onClick={() => navigate({ to: "/app/incidents/$id", params: { id: incidents[0].id } })}
      className="mx-2 mb-2 flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-xs font-semibold text-white"
      style={{ animation: "lemtik-emergency-flash 0.9s ease-in-out infinite" }}
    >
      <style>{`
        @keyframes lemtik-emergency-flash {
          0%, 100% { background-color: rgb(220 38 38); }
          50% { background-color: rgb(127 29 29); }
        }
      `}</style>
      <ShieldAlert className="h-4 w-4 shrink-0" />
      <span>
        {incidents.length === 1 ? "Guest emergency — needs attention" : `${incidents.length} guest emergencies — need attention`}
      </span>
    </button>
  );
}
