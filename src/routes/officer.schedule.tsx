import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { Status, type Tone } from "@/components/nw";
import { fmtTime, NetPill, useMyShifts } from "@/components/officer/kit";

export const Route = createFileRoute("/officer/schedule")({
  component: OfficerSchedule,
});

const TONE: Record<string, Tone> = { active: "ok", scheduled: "blue", completed: "off", cancelled: "fail" };

function OfficerSchedule() {
  const { shifts, isLoading } = useMyShifts();
  const now = Date.now();
  const upcoming = shifts.filter((s) => Date.parse(s.scheduled_end) >= now && s.status !== "cancelled" && s.status !== "completed");
  const past = shifts.filter((s) => !upcoming.includes(s)).reverse().slice(0, 10);

  const row = (s: (typeof shifts)[number]) => (
    <div key={s.id} className="o-card row g12">
      <span className="col f1" style={{ minWidth: 0 }}>
        <b>
          {new Date(s.scheduled_start).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} · {fmtTime(s.scheduled_start)} – {fmtTime(s.scheduled_end)}
        </b>
        <span className="t3 trunc">{s.patrol_code ?? "Patrol route"}</span>
      </span>
      <Status tone={TONE[s.status] ?? "neutral"}>{s.status}</Status>
    </div>
  );

  return (
    <>
      <div className="o-h">
        <Link to="/officer/home" className="ibtn" aria-label="Back">
          <ChevronLeft size={18} />
        </Link>
        <h1 className="f1">My shifts</h1>
        <NetPill />
      </div>
      <div className="o-b">
        {isLoading ? (
          <div className="o-card t3">Loading…</div>
        ) : (
          <>
            <span className="o-lbl">COMING UP</span>
            {upcoming.length ? upcoming.map(row) : <div className="o-card t3">No upcoming shifts assigned to you.</div>}
            {past.length > 0 && (
              <>
                <span className="o-lbl" style={{ marginTop: 8 }}>
                  RECENT
                </span>
                {past.map(row)}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
