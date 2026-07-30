export type Severity = 1 | 2 | 3 | 4 | 5;
export type IncidentStatus = "reported" | "acknowledged" | "responding" | "contained" | "resolved" | "escalated" | "closed";
export type IncidentType =
  | "intrusion" | "theft" | "robbery" | "armed_attack" | "kidnapping"
  | "medical" | "fire" | "suspicious" | "civil_unrest" | "vandalism"
  | "fraud_scam" | "cyber_incident" | "other";

export const severityMeta: Record<Severity, { label: string; sublabel: string; token: string; }> = {
  5: { label: "Critical", sublabel: "Life at risk / major threat", token: "critical" },
  4: { label: "High", sublabel: "Urgent response", token: "high" },
  3: { label: "Medium", sublabel: "Response needed", token: "medium" },
  2: { label: "Low", sublabel: "Monitor situation", token: "low" },
  1: { label: "Minor", sublabel: "No immediate risk", token: "resolved" },
};

export const statusMeta: Record<IncidentStatus, string> = {
  reported: "Reported",
  acknowledged: "Acknowledged",
  responding: "Responding",
  contained: "Contained",
  resolved: "Resolved",
  escalated: "Escalated",
  closed: "Closed",
};

export const typeMeta: Record<IncidentType, string> = {
  intrusion: "Intrusion",
  theft: "Theft",
  robbery: "Robbery",
  armed_attack: "Armed Attack",
  kidnapping: "Kidnapping",
  medical: "Medical Emergency",
  fire: "Fire",
  suspicious: "Suspicious Activity",
  civil_unrest: "Civil Unrest",
  vandalism: "Vandalism",
  fraud_scam: "Fraud / Scam",
  cyber_incident: "Cyber Incident",
  other: "Other",
};
