// Builds what a recipient sees for one shared record. Only the parts in the share's scope
// leave the owner's organisation; everything is read with the service role after the share
// has been checked.

import { createHash } from "node:crypto";
import { getRequest } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const db = () => supabaseAdmin as any;

export type ShareScope = "summary" | "location" | "track" | "evidence" | "people";
export type ShareRow = {
  id: string;
  organisation_id: string;
  record_kind: "incident" | "voyage" | "movement_alert";
  record_id: string;
  record_label: string;
  partner_org_id: string | null;
  share_token: string | null;
  recipient_label: string;
  recipient_contact: string | null;
  scopes: ShareScope[];
  purpose: string;
  expires_at: string;
  status: "pending_approval" | "active" | "declined" | "revoked";
  requested_by: string;
  requested_by_name: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  decline_reason: string | null;
  first_viewed_at: string | null;
  view_count: number;
  acknowledged_at: string | null;
  acknowledged_by_name: string | null;
  ack_note: string | null;
  revoked_at: string | null;
  revoked_by_name: string | null;
  created_at: string;
};
export const SHARE_COLS =
  "id, organisation_id, requested_by, record_kind, record_id, record_label, partner_org_id, share_token, recipient_label, recipient_contact, scopes, purpose, expires_at, status, requested_by_name, approved_by_name, approved_at, decline_reason, first_viewed_at, view_count, acknowledged_at, acknowledged_by_name, ack_note, revoked_at, revoked_by_name, created_at";

export type SharedRecord = {
  share: { id: string; record_kind: ShareRow["record_kind"]; record_label: string; purpose: string; expires_at: string; scopes: ShareScope[]; owner: string; owner_contact: string | null; shared_by: string | null; acknowledged_at: string | null; acknowledged_by_name: string | null; ack_note: string | null };
  facts: { label: string; value: string }[];
  timeline: { at: string; text: string }[];
  point: { lat: number; lng: number; at: string | null; label: string } | null;
  track: [number, number][];
  route: [number, number][];
  people: { label: string; value: string }[];
  evidence: { name: string; kind: string; url: string | null }[];
  generated_at: string;
};

export function shareState(s: Pick<ShareRow, "status" | "expires_at">): "pending_approval" | "active" | "declined" | "revoked" | "expired" {
  if (s.status === "active" && Date.parse(s.expires_at) <= Date.now()) return "expired";
  return s.status;
}

const lagos = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const words = (v: unknown) => String(v ?? "").replace(/_/g, " ");

async function positions(subjectId: string, since: string, until?: string | null) {
  const { data } = await db()
    .from("movement_positions")
    .select("lat, lng, accuracy_m, recorded_at")
    .eq("subject_id", subjectId)
    .gte("recorded_at", since)
    .lte("recorded_at", until ?? new Date().toISOString())
    .order("recorded_at", { ascending: true })
    .limit(3000);
  const good = ((data ?? []) as any[]).filter((r) => r.accuracy_m == null || r.accuracy_m <= 150);
  const step = Math.max(1, Math.ceil(good.length / 800));
  return good.filter((_, i) => i % step === 0 || i === good.length - 1).map((r) => [r.lng, r.lat] as [number, number]);
}

export async function buildSharedRecord(s: ShareRow): Promise<SharedRecord> {
  const has = (x: ShareScope) => s.scopes.includes(x);
  const { data: org } = await db().from("organisations").select("name, billing_contact_phone").eq("id", s.organisation_id).maybeSingle();
  const out: SharedRecord = {
    share: { id: s.id, record_kind: s.record_kind, record_label: s.record_label, purpose: s.purpose, expires_at: s.expires_at, scopes: s.scopes, owner: org?.name ?? "", owner_contact: org?.billing_contact_phone ?? null, shared_by: s.approved_by_name ?? s.requested_by_name, acknowledged_at: s.acknowledged_at, acknowledged_by_name: s.acknowledged_by_name, ack_note: s.ack_note },
    facts: [],
    timeline: [],
    point: null,
    track: [],
    route: [],
    people: [],
    evidence: [],
    generated_at: new Date().toISOString(),
  };

  if (s.record_kind === "incident") {
    const { data: i } = await db().from("incidents").select("*").eq("id", s.record_id).eq("organisation_id", s.organisation_id).maybeSingle();
    if (!i) return out;
    out.facts = [
      { label: "Reference", value: String(i.code ?? "") },
      { label: "Type", value: words(i.type) },
      { label: "Severity", value: `${i.severity ?? "—"} of 5` },
      { label: "Status", value: words(i.status) },
      { label: "Occurred", value: lagos(i.occurred_at ?? i.reported_at) },
      { label: "Reported", value: lagos(i.reported_at) },
      ...(i.description ? [{ label: "What happened", value: String(i.description) }] : []),
      ...(has("location") && (i.location || i.zone) ? [{ label: "Location", value: [i.location, i.zone].filter(Boolean).join(" · ") }] : []),
      ...(i.suspect_count != null ? [{ label: "Suspects", value: String(i.suspect_count) }] : []),
    ];
    if (has("location") && i.coord_y != null && i.coord_x != null) out.point = { lat: Number(i.coord_y), lng: Number(i.coord_x), at: i.occurred_at ?? i.reported_at, label: "Incident" };
    if (has("people")) {
      out.people = [
        ...(i.victim_name ? [{ label: "Victim", value: String(i.victim_name) }] : []),
        ...(i.suspect_description ? [{ label: "Suspect description", value: String(i.suspect_description) }] : []),
        ...(i.witnesses ? [{ label: "Witnesses", value: typeof i.witnesses === "string" ? i.witnesses : JSON.stringify(i.witnesses) }] : []),
        ...(i.officer ? [{ label: "Assigned officer", value: String(i.officer) }] : []),
      ];
    }
    const { data: act } = await db().from("incident_activity").select("created_at, kind, message").eq("incident_id", i.id).order("created_at", { ascending: true }).limit(200);
    out.timeline = ((act ?? []) as any[]).filter((a) => a.message).map((a) => ({ at: a.created_at, text: String(a.message) }));
    if (has("evidence")) {
      const items = (Array.isArray(i.evidence) ? i.evidence : []) as any[];
      out.evidence = await Promise.all(
        items.slice(0, 50).map(async (e) => {
          const { data: u } = e.path ? await db().storage.from("incident-evidence").createSignedUrl(e.path, 900) : { data: null };
          return { name: String(e.name ?? "file"), kind: String(e.kind ?? "document"), url: u?.signedUrl ?? null };
        }),
      );
    }
    return out;
  }

  // Voyages and movement alerts both centre on a tracked boat or person.
  let voyageId: string | null = null;
  let subjectId: string | null = null;
  let alert: any = null;
  if (s.record_kind === "movement_alert") {
    const { data: a } = await db().from("movement_alerts").select("id, subject_id, voyage_id, kind, severity, message, lat, lng, created_at, acknowledged_at").eq("id", s.record_id).eq("organisation_id", s.organisation_id).maybeSingle();
    if (!a) return out;
    alert = a;
    voyageId = a.voyage_id;
    subjectId = a.subject_id;
  } else {
    voyageId = s.record_id;
  }
  const { data: v } = voyageId ? await db().from("movement_voyages").select("id, subject_id, name, status, route, planned_departure, planned_arrival, departed_at, arrived_at, departure_count, arrival_count, crew").eq("id", voyageId).eq("organisation_id", s.organisation_id).maybeSingle() : { data: null };
  if (s.record_kind === "voyage" && !v) return out;
  subjectId = subjectId ?? v?.subject_id ?? null;
  const { data: subj } = subjectId ? await db().from("movement_subjects").select("name, kind, reference, mmsi, last_lat, last_lng, last_seen_at, state, last_speed_mps").eq("id", subjectId).maybeSingle() : { data: null };

  if (alert) {
    out.facts.push(
      { label: "Alert", value: String(alert.message) },
      { label: "Kind", value: words(alert.kind) },
      { label: "Severity", value: `${alert.severity} of 5` },
      { label: "Raised", value: lagos(alert.created_at) },
      { label: "Acknowledged by the operator", value: alert.acknowledged_at ? lagos(alert.acknowledged_at) : "Not yet" },
    );
  }
  if (subj) out.facts.push({ label: subj.kind === "vessel" ? "Boat" : subj.kind === "vehicle" ? "Vehicle" : "Person", value: `${subj.name}${subj.reference ? ` · ${subj.reference}` : ""}${subj.mmsi ? ` · MMSI ${subj.mmsi}` : ""}` }, { label: "Current state", value: words(subj.state) });
  if (v) {
    out.facts.push(
      { label: "Voyage", value: `${v.name} (${words(v.status)})` },
      { label: "Departed", value: v.departed_at ? lagos(v.departed_at) : `Planned ${lagos(v.planned_departure)}` },
      { label: "Arrival", value: v.arrived_at ? lagos(v.arrived_at) : `Planned ${lagos(v.planned_arrival)}` },
      { label: "People aboard", value: v.departure_count != null ? `${v.departure_count} at departure${v.arrival_count != null ? `, ${v.arrival_count} at arrival` : ""}` : "Not recorded" },
    );
    if (has("track") && Array.isArray(v.route)) out.route = v.route as [number, number][];
  }
  if (has("location") && subj?.last_lat != null) out.point = { lat: subj.last_lat, lng: subj.last_lng, at: subj.last_seen_at, label: `Last position${subj.last_speed_mps != null ? ` · ${(subj.last_speed_mps * 1.943844).toFixed(1)} kn` : ""}` };
  else if (has("location") && alert?.lat != null) out.point = { lat: alert.lat, lng: alert.lng, at: alert.created_at, label: "Where the alert was raised" };
  if (has("track") && subjectId) {
    const since = v?.departed_at ?? new Date(Date.parse(alert?.created_at ?? new Date().toISOString()) - 2 * 3600_000).toISOString();
    out.track = await positions(subjectId, since, v?.arrived_at ?? null);
  }
  if (has("people") && v) {
    const crew = (Array.isArray(v.crew) ? v.crew : []) as { name: string; role?: string }[];
    const { data: pax } = await db().from("voyage_passengers").select("name, phone, next_of_kin_phone").eq("voyage_id", v.id).limit(500);
    out.people = [
      ...crew.map((c) => ({ label: c.role ? `Crew · ${c.role}` : "Crew", value: c.name })),
      ...((pax ?? []) as any[]).map((p) => ({ label: "Passenger", value: `${p.name}${p.phone ? ` · ${p.phone}` : ""}${p.next_of_kin_phone ? ` · next of kin ${p.next_of_kin_phone}` : ""}` })),
    ];
  }
  if (v) {
    const { data: al } = await db().from("movement_alerts").select("kind, severity, message, created_at").eq("voyage_id", v.id).order("created_at", { ascending: true }).limit(200);
    out.timeline = [
      ...(v.departed_at ? [{ at: v.departed_at, text: "Departed" }] : []),
      ...((al ?? []) as any[]).map((a) => ({ at: a.created_at, text: `${a.message} (severity ${a.severity})` })),
      ...(v.arrived_at ? [{ at: v.arrived_at, text: "Arrived" }] : []),
    ].sort((a, b) => a.at.localeCompare(b.at));
  }
  return out;
}

/** Logs a view, counting it at most once every 10 minutes per viewer. */
export async function logView(s: ShareRow, viewer: { name: string | null; org: string | null; via: "app" | "link"; key: string }) {
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: recent } = await db().from("record_share_events").select("id").eq("share_id", s.id).eq("action", "viewed").gte("created_at", since).contains("detail", { key: viewer.key }).limit(1);
  if (recent?.length) return;
  const first = !s.first_viewed_at;
  await db().from("record_share_events").insert({ share_id: s.id, organisation_id: s.organisation_id, action: "viewed", actor_name: viewer.name, actor_org_name: viewer.org, via: viewer.via, detail: { key: viewer.key } });
  await db().from("record_shares").update({ view_count: (s.view_count ?? 0) + 1, ...(first ? { first_viewed_at: new Date().toISOString() } : {}) }).eq("id", s.id);
  if (first) await notifyStaff(s.organisation_id, ["manager", "supervisor"], `${s.recipient_label} opened the shared ${kindWord(s.record_kind)}: ${s.record_label}`, `First opened ${lagos(new Date().toISOString())}${viewer.name ? ` by ${viewer.name}` : ""}.`, 2);
}

export const kindWord = (k: ShareRow["record_kind"]) => (k === "movement_alert" ? "alert" : k);

/** In-app alert to the managers (and optionally operators) of one organisation. */
export async function notifyStaff(orgId: string, roles: string[], title: string, body: string, severity = 2) {
  const { data: members } = await db().from("organisation_members").select("user_id").eq("organisation_id", orgId).in("role", roles);
  const ids = ((members ?? []) as { user_id: string }[]).map((m) => m.user_id);
  if (!ids.length) return;
  await db().from("alerts").insert({
    organisation_id: orgId, severity, channel: "in-app", channels: ["in-app"], alert_type: "record_share", status: "delivered",
    title: title.slice(0, 200), body: body.slice(0, 1000), action: "Open shared records", recipients: ids.length, delivered_count: ids.length, failed_count: 0,
    recipient_user_ids: ids, acknowledged: false,
  });
}

/** A short, non-reversible key for an anonymous viewer (IP + browser), used only to avoid counting reloads. */
export function linkViewerKey() {
  const h = getRequest()?.headers;
  const ip = h?.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h?.get("x-real-ip") ?? "";
  return createHash("sha256").update(`${ip}|${h?.get("user-agent") ?? ""}`).digest("hex").slice(0, 16);
}
