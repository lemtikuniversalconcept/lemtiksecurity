import { Status } from "@/components/nw";
import { CLOCK_MARK_DAYS, type ViolationClock } from "@/lib/isps.rules";

const dateOnly = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" }) : "—");

/** One line: how long the facility has been continuously failing a rule, against the three-month mark. */
export function ClosureClock({ clock, compact = false }: { clock: ViolationClock; compact?: boolean }) {
  if (!clock.since) return compact ? null : <Status tone="ok">No rule failing now</Status>;
  const tone = clock.past_mark ? "fail" : clock.days >= 60 ? "warn" : "neutral";
  const left = CLOCK_MARK_DAYS - clock.days;
  return (
    <span className="row g6 wrap" style={{ alignItems: "center" }} title={clock.causes.map((c) => `${c.text} since ${dateOnly(c.since)}`).join("\n")}>
      <Status tone={tone}>{clock.days} day{clock.days === 1 ? "" : "s"} failing a rule</Status>
      <span className="t3" style={{ fontSize: 12 }}>
        since {dateOnly(clock.since)} · {clock.past_mark ? `past the three-month mark by ${clock.days - CLOCK_MARK_DAYS} day${clock.days - CLOCK_MARK_DAYS === 1 ? "" : "s"}` : `reaches three months on ${dateOnly(clock.mark_on)} (${left} day${left === 1 ? "" : "s"})`}
        {!compact && ` · ${clock.causes.map((c) => c.text.toLowerCase()).join("; ")}`}
      </span>
    </span>
  );
}

export const CLOCK_NOTE = `The clock counts unbroken days on which at least one rule was failing and is still failing now: a drill overdue (every 3 months), an exercise overdue (every 18 months at most), the security plan approval lapsed, or a breach not reported to the authority. It resets when every one of those is put right. Lemtik counts the days; what to do at three months is the authority's decision.`;
