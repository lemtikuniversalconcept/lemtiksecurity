export type Severity = 1 | 2 | 3 | 4 | 5;
export type IncidentStatus = "reported" | "acknowledged" | "responding" | "contained" | "resolved" | "escalated" | "closed";
export type IncidentType =
  | "intrusion" | "theft" | "robbery" | "armed_attack" | "kidnapping"
  | "medical" | "fire" | "suspicious" | "civil_unrest" | "vandalism"
  | "fraud_scam" | "cyber_incident" | "other";


export interface Incident {
  id: string;
  type: IncidentType;
  severity: Severity;
  status: IncidentStatus;
  location: string;
  zone: string;
  coords: { x: number; y: number }; // % within map canvas
  reportedAt: string;
  officer: string;
  description: string;
}

export const incidents: Incident[] = [
  { id: "LEM-2041", type: "intrusion", severity: 5, status: "responding", location: "Gate 3, Block C", zone: "Lekki Phase 1", coords: { x: 72, y: 38 }, reportedAt: "2 min ago", officer: "Adebayo O.", description: "Two unidentified individuals scaled the perimeter wall near Block C service entrance." },
  { id: "LEM-2040", type: "suspicious", severity: 3, status: "acknowledged", location: "Admiralty Way", zone: "Lekki Phase 1", coords: { x: 44, y: 60 }, reportedAt: "11 min ago", officer: "Chinwe M.", description: "Vehicle circling estate perimeter — registration logged." },
  { id: "LEM-2039", type: "theft", severity: 4, status: "escalated", location: "Visitor lot B", zone: "VI Waterfront", coords: { x: 28, y: 22 }, reportedAt: "34 min ago", officer: "Tunde K.", description: "Side mirror theft reported by resident. CCTV footage pulled." },
  { id: "LEM-2038", type: "medical", severity: 2, status: "resolved", location: "Block A pool", zone: "Ikoyi Heights", coords: { x: 58, y: 78 }, reportedAt: "1 hr ago", officer: "Funke A.", description: "Minor slip — first aid administered. No follow-up needed." },
  { id: "LEM-2037", type: "fire", severity: 5, status: "resolved", location: "Generator house", zone: "Ajah Estate", coords: { x: 84, y: 70 }, reportedAt: "3 hr ago", officer: "Emeka I.", description: "Small electrical fire contained with extinguisher. LASEMA notified." },
  { id: "LEM-2036", type: "civil_unrest", severity: 4, status: "contained", location: "Main gate", zone: "Lekki Phase 1", coords: { x: 18, y: 48 }, reportedAt: "5 hr ago", officer: "Adebayo O.", description: "Dispute between okada riders and residents — dispersed peacefully." },
  { id: "LEM-2035", type: "suspicious", severity: 2, status: "resolved", location: "Service road", zone: "VI Waterfront", coords: { x: 36, y: 34 }, reportedAt: "8 hr ago", officer: "Bisi L.", description: "Drone sighting investigated — neighbour's hobby drone." },
  { id: "LEM-2034", type: "intrusion", severity: 5, status: "resolved", location: "Perimeter fence E", zone: "Ikoyi Heights", coords: { x: 64, y: 16 }, reportedAt: "12 hr ago", officer: "Chinwe M.", description: "Fence breach repaired. Suspect fled before response team arrival." },
];

export interface PatrolRoute {
  id: string;
  name: string;
  officer: string;
  shift: string;
  waypoints: number;
  checkedIn: number;
  status: "on_route" | "delayed" | "complete" | "missed";
  nextCheckIn: string;
}

export const patrols: PatrolRoute[] = [
  { id: "PT-01", name: "Phase 1 Perimeter Loop", officer: "Adebayo O.", shift: "18:00 – 06:00", waypoints: 8, checkedIn: 5, status: "on_route", nextCheckIn: "in 4 min" },
  { id: "PT-02", name: "Block A–D Sweep", officer: "Chinwe M.", shift: "18:00 – 06:00", waypoints: 6, checkedIn: 6, status: "complete", nextCheckIn: "—" },
  { id: "PT-03", name: "Waterfront East", officer: "Tunde K.", shift: "20:00 – 04:00", waypoints: 5, checkedIn: 2, status: "delayed", nextCheckIn: "overdue 3 min" },
  { id: "PT-04", name: "Ajah Service Road", officer: "Emeka I.", shift: "22:00 – 06:00", waypoints: 7, checkedIn: 0, status: "missed", nextCheckIn: "overdue 14 min" },
  { id: "PT-05", name: "Ikoyi Gate Rotation", officer: "Funke A.", shift: "18:00 – 06:00", waypoints: 4, checkedIn: 3, status: "on_route", nextCheckIn: "in 11 min" },
];

export interface AlertItem {
  id: string;
  title: string;
  channel: "in-app" | "sms" | "whatsapp" | "email";
  severity: Severity;
  sentAt: string;
  recipients: number;
  acknowledged: boolean;
}

export const alerts: AlertItem[] = [
  { id: "AL-901", title: "Critical intrusion — Gate 3, Block C", channel: "whatsapp", severity: 5, sentAt: "2 min ago", recipients: 6, acknowledged: false },
  { id: "AL-900", title: "Patrol PT-04 missed check-in", channel: "sms", severity: 3, sentAt: "14 min ago", recipients: 2, acknowledged: true },
  { id: "AL-899", title: "Suspicious vehicle — Admiralty Way", channel: "in-app", severity: 3, sentAt: "11 min ago", recipients: 4, acknowledged: true },
  { id: "AL-898", title: "Daily summary — Lekki Phase 1", channel: "email", severity: 1, sentAt: "Today 07:00", recipients: 3, acknowledged: true },
  { id: "AL-897", title: "Theft escalated to LSPD", channel: "whatsapp", severity: 4, sentAt: "34 min ago", recipients: 5, acknowledged: true },
];

export interface TeamMember {
  id: string;
  name: string;
  role: "Field Officer" | "Supervisor" | "Security Manager" | "Client Admin";
  zone: string;
  status: "on-duty" | "off-duty" | "break";
  lastActive: string;
}

export const team: TeamMember[] = [
  { id: "U-01", name: "Adebayo Ogundimu", role: "Field Officer", zone: "Lekki Phase 1", status: "on-duty", lastActive: "now" },
  { id: "U-02", name: "Chinwe Madu", role: "Supervisor", zone: "Lekki Phase 1", status: "on-duty", lastActive: "2 min ago" },
  { id: "U-03", name: "Tunde Kareem", role: "Field Officer", zone: "VI Waterfront", status: "on-duty", lastActive: "5 min ago" },
  { id: "U-04", name: "Funke Adesanya", role: "Field Officer", zone: "Ikoyi Heights", status: "break", lastActive: "12 min ago" },
  { id: "U-05", name: "Emeka Ifeanyi", role: "Field Officer", zone: "Ajah Estate", status: "on-duty", lastActive: "1 min ago" },
  { id: "U-06", name: "Lola Bankole", role: "Security Manager", zone: "All zones", status: "on-duty", lastActive: "just now" },
  { id: "U-07", name: "Mr. Okafor (Client)", role: "Client Admin", zone: "Lekki Phase 1", status: "off-duty", lastActive: "yesterday" },
];

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


export const weeklyTrend = [
  { day: "Mon", incidents: 4, resolved: 3 },
  { day: "Tue", incidents: 7, resolved: 6 },
  { day: "Wed", incidents: 5, resolved: 5 },
  { day: "Thu", incidents: 9, resolved: 7 },
  { day: "Fri", incidents: 12, resolved: 9 },
  { day: "Sat", incidents: 15, resolved: 11 },
  { day: "Sun", incidents: 8, resolved: 8 },
];

export const zoneRisk = [
  { zone: "Lekki Phase 1", score: 72, trend: "+8%" },
  { zone: "VI Waterfront", score: 58, trend: "−3%" },
  { zone: "Ikoyi Heights", score: 41, trend: "+1%" },
  { zone: "Ajah Estate", score: 64, trend: "+12%" },
];
