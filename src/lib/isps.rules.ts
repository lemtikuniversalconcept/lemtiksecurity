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
