// ISPS Code record-keeping checks, following the Code's Part B guidance:
//  - drills at least every three months (B/13.6 ships, B/18.5 port facilities)
//  - exercises at least once each calendar year, no more than 18 months apart (B/13.7, B/18.6)
//  - an approved security plan that hasn't lapsed (expiry entered by the facility)
// These are prompts for the security officer, not a legal opinion.

export type ComplianceFlag = { code: "drill" | "exercise" | "plan" | "breach_unreported" | "officer"; tone: "fail" | "warn"; text: string };

const DAY = 86_400_000;
const days = (from: string, to = Date.now()) => Math.floor((to - Date.parse(from)) / DAY);

export function complianceFlags(f: {
  last_drill_on: string | null;
  last_exercise_on: string | null;
  plan_expires_on: string | null;
  plan_approved_on: string | null;
  security_officer_name: string | null;
  unreported_breaches: number;
  created_at: string;
}): ComplianceFlag[] {
  const out: ComplianceFlag[] = [];
  const now = Date.now();
  if (!f.security_officer_name) out.push({ code: "officer", tone: "warn", text: "No security officer named" });
  if (f.last_drill_on) {
    const d = days(f.last_drill_on);
    if (d > 92) out.push({ code: "drill", tone: "fail", text: `Drill overdue: last one ${d} days ago (due every 3 months)` });
    else if (d > 76) out.push({ code: "drill", tone: "warn", text: `Drill due within ${92 - d} days` });
  } else if (days(f.created_at) > 30) out.push({ code: "drill", tone: "fail", text: "No drill recorded" });
  else out.push({ code: "drill", tone: "warn", text: "No drill recorded yet" });
  if (f.last_exercise_on) {
    const d = days(f.last_exercise_on);
    const thisYear = new Date(f.last_exercise_on).getUTCFullYear() === new Date(now).getUTCFullYear();
    if (d > 548) out.push({ code: "exercise", tone: "fail", text: `Exercise overdue: last one ${Math.round(d / 30)} months ago (max 18 months apart)` });
    else if (!thisYear && new Date(now).getUTCMonth() >= 9) out.push({ code: "exercise", tone: "warn", text: `No exercise yet in ${new Date(now).getUTCFullYear()} (one is due each calendar year)` });
  } else out.push({ code: "exercise", tone: days(f.created_at) > 365 ? "fail" : "warn", text: "No exercise recorded" });
  if (!f.plan_approved_on) out.push({ code: "plan", tone: "warn", text: "Security plan approval date not entered" });
  if (f.plan_expires_on) {
    const left = Math.floor((Date.parse(f.plan_expires_on) - now) / DAY);
    if (left < 0) out.push({ code: "plan", tone: "fail", text: `Security plan approval lapsed ${-left} days ago` });
    else if (left <= 60) out.push({ code: "plan", tone: "warn", text: `Security plan approval lapses in ${left} days` });
  }
  if (f.unreported_breaches > 0) out.push({ code: "breach_unreported", tone: "fail", text: `${f.unreported_breaches} breach${f.unreported_breaches === 1 ? "" : "es"} not yet reported to the authority` });
  return out;
}

export const LEVEL_LABEL: Record<number, string> = { 1: "Level 1 · Normal", 2: "Level 2 · Heightened", 3: "Level 3 · Exceptional" };
export const BREACH_LABEL: Record<string, string> = {
  unauthorised_access: "Unauthorised access",
  stowaway: "Stowaway",
  theft: "Theft or pilferage",
  tampering: "Tampering with cargo, stores or equipment",
  suspicious_activity: "Suspicious activity or surveillance",
  armed_attack: "Armed attack or robbery",
  smuggling: "Smuggling (drugs, weapons, people)",
  cyber: "Cyber incident",
  other: "Other",
};
export const FACILITY_KIND: Record<string, string> = { port_facility: "Port facility", terminal: "Terminal", jetty: "Jetty", offshore: "Offshore installation", ship: "Ship" };

// ───────────── Training records ─────────────

export const TRAINING_WARN_DAYS = 60;
export type TrainingState = "valid" | "expiring" | "expired" | "no_expiry";
/** Where a certificate stands on a given day (YYYY-MM-DD, Lagos). */
export function trainingState(expires_on: string | null, today: string): { state: TrainingState; days_left: number | null } {
  if (!expires_on) return { state: "no_expiry", days_left: null };
  const days = Math.round((Date.parse(`${expires_on}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return { state: days < 0 ? "expired" : days <= TRAINING_WARN_DAYS ? "expiring" : "valid", days_left: days };
}
export const ROLE_SUGGESTIONS = ["Port Facility Security Officer (PFSO)", "Deputy PFSO", "Company Security Officer (CSO)", "Ship Security Officer (SSO)", "Security supervisor", "Security guard", "Access control officer", "CCTV operator"];

// ───────────── Breach → incident ─────────────

/** The incident type and starting severity for each ISPS breach category. */
export const BREACH_INCIDENT: Record<string, { type: string; severity: number }> = {
  unauthorised_access: { type: "intrusion", severity: 3 },
  stowaway: { type: "stowaway", severity: 3 },
  theft: { type: "theft", severity: 3 },
  tampering: { type: "vandalism", severity: 3 },
  suspicious_activity: { type: "suspicious", severity: 2 },
  armed_attack: { type: "armed_attack", severity: 5 },
  smuggling: { type: "other", severity: 4 },
  cyber: { type: "cyber_incident", severity: 3 },
  other: { type: "other", severity: 2 },
};

// ───────────── Closure clock ─────────────

export const CLOCK_MARK_DAYS = 90;
export type ClockCause = { code: "drill" | "exercise" | "plan" | "breach_unreported"; since: string; text: string };
export type ViolationClock = { since: string | null; days: number; past_mark: boolean; mark_on: string | null; causes: ClockCause[] };

/**
 * How long a facility has been continuously failing at least one rule that is still failing
 * now, and when (or whether) that passes three months. Every cause counted is still open, so
 * the run is unbroken from the earliest one's start.
 */
export function violationClock(f: {
  last_drill_on: string | null;
  last_exercise_on: string | null;
  plan_expires_on: string | null;
  created_at: string;
  oldest_unreported_breach_at: string | null;
}, now = Date.now()): ViolationClock {
  const causes: ClockCause[] = [];
  const at = (ms: number) => new Date(ms).toISOString();
  const drillDue = (f.last_drill_on ? Date.parse(f.last_drill_on) : Date.parse(f.created_at)) + 92 * DAY;
  if (drillDue < now) causes.push({ code: "drill", since: at(drillDue), text: f.last_drill_on ? "Drill overdue (every 3 months)" : "No drill within 3 months of registering" });
  const exDue = f.last_exercise_on ? Date.parse(f.last_exercise_on) + 548 * DAY : Date.parse(f.created_at) + 365 * DAY;
  if (exDue < now) causes.push({ code: "exercise", since: at(exDue), text: f.last_exercise_on ? "Exercise overdue (max 18 months apart)" : "No exercise within a year of registering" });
  if (f.plan_expires_on) {
    const lapsed = Date.parse(`${f.plan_expires_on}T00:00:00+01:00`) + DAY;
    if (lapsed <= now) causes.push({ code: "plan", since: at(lapsed), text: "Security plan approval lapsed" });
  }
  if (f.oldest_unreported_breach_at) causes.push({ code: "breach_unreported", since: f.oldest_unreported_breach_at, text: "Breach not reported to the authority" });
  causes.sort((a, b) => a.since.localeCompare(b.since));
  if (!causes.length) return { since: null, days: 0, past_mark: false, mark_on: null, causes };
  const since = Date.parse(causes[0].since);
  const days = Math.floor((now - since) / DAY);
  return { since: causes[0].since, days, past_mark: days >= CLOCK_MARK_DAYS, mark_on: at(since + CLOCK_MARK_DAYS * DAY), causes };
}

// ───────────── Checklists for each security level ─────────────

export type IspsPost = { id: string; name: string };
export type LevelMeasure = { text: string; post_id: string | null };
export type LevelMeasures = Partial<Record<"1" | "2" | "3", LevelMeasure[]>>;

/**
 * What each post must do at a level: measures for every post, plus the post's own. With no
 * posts set up, one checklist for the whole facility. Posts with nothing to do are left out.
 */
export function checklistsFor(posts: IspsPost[], measures: LevelMeasures, level: number): { post_id: string | null; post_name: string; items: string[] }[] {
  const list = (measures[String(level) as "1" | "2" | "3"] ?? []).filter((m) => m.text.trim());
  if (!list.length) return [];
  if (!posts.length) return [{ post_id: null, post_name: "Whole facility", items: list.map((m) => m.text.trim()) }];
  return posts
    .map((p) => ({ post_id: p.id, post_name: p.name, items: list.filter((m) => !m.post_id || m.post_id === p.id).map((m) => m.text.trim()) }))
    .filter((c) => c.items.length);
}
