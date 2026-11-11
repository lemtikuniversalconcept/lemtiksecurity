import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getActiveOrgId } from "@/lib/orgs.server";
import { throwSafeError } from "@/lib/server-errors";
import { recordBlackboxAudit } from "@/lib/audit.server";

/**
 * Court-ready case files. A case file freezes an incident or a voyage into a manifest:
 * the record, its timeline, and every evidence file's SHA-256 fingerprint with its chain of
 * custody. The manifest's own SHA-256 is stored, so the downloaded bundle can be checked
 * on the public verify page (or with any SHA-256 tool) at any time.
 */

export const CASE_FILE_FORMAT = "lemtik-case-file/1";

export type CaseEvidence = {
  file: string; // name inside the bundle
  name: string;
  kind: string;
  size: number | null;
  sha256: string | null; // at the time the case file was made
  sha256_on_receipt: string | null; // fingerprint taken when the file was uploaded
  integrity: "matches_receipt" | "changed_since_receipt" | "no_receipt_fingerprint" | "unreadable";
  added_at: string | null;
  added_by: string | null;
  legal_hold: boolean;
  custody: { at: string; by: string | null; action: string; note: string | null }[];
  record_id?: string; // the voyage record a media file came from
};
export type CaseTimelineEntry = { at: string; by: string | null; kind: string; text: string };
export type CasePlanRow = { item: string; planned: string | null; actual: string | null; note: string | null };
export type CaseMap = { route: [number, number][]; corridor_m: number; track: [number, number][]; points: { lng: number; lat: number; label: string; severity: number }[] };
export type CaseMaritime = {
  summary: string;
  plan_vs_actual: CasePlanRow[];
  counts: { label: string; value: string }[];
  map: CaseMap;
  statements: { file: string; given_by: string; role: string | null; contact: string | null; taken_at: string; recorded_by: string | null; sha256: string; text: string }[];
};
export type CaseManifest = {
  format: typeof CASE_FILE_FORMAT;
  case_file_id: string;
  generated_at: string;
  generated_by: string;
  organisation: string;
  kind: "incident" | "voyage" | "consignment";
  reference: string;
  title: string;
  record: Record<string, string | number | boolean | null>;
  timeline: CaseTimelineEntry[];
  evidence: CaseEvidence[];
  data_files: { file: string; description: string; sha256: string; rows: number }[];
  maritime?: CaseMaritime; // voyage case files made from November 2026
};
export type CaseFileRow = {
  id: string;
  kind: "incident" | "voyage" | "consignment";
  record_id: string;
  reference: string;
  manifest_text: string;
  manifest_sha256: string;
  file_count: number;
  generated_by_name: string | null;
  created_at: string;
};

const sb = (c: { supabase: unknown }) => c.supabase as any;
const safeName = (n: string) => n.replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "file";

async function displayName(supabase: any, userId: string) {
  const { data } = await supabase.from("profiles").select("display_name").eq("user_id", userId).maybeSingle();
  return (data?.display_name as string | undefined)?.trim() || "Lemtik user";
}

async function incidentParts(supabase: any, orgId: string, id: string) {
  const { data: inc, error } = await supabase.from("incidents").select("*").eq("id", id).eq("organisation_id", orgId).maybeSingle();
  if (error || !inc) throwSafeError("casefile.incident", error ?? new Error("not found"), "Incident not found.");
  const [act, notes, esc] = await Promise.all([
    supabase.from("incident_activity").select("created_at, actor_name, kind, message").eq("incident_id", id).order("created_at", { ascending: true }).limit(2000),
    supabase.from("incident_notes").select("*").eq("incident_id", id).order("created_at", { ascending: true }).limit(1000),
    supabase.from("incident_escalations").select("*").eq("incident_id", id).order("created_at", { ascending: true }).limit(200),
  ]);
  const timeline: CaseTimelineEntry[] = [
    ...(act.data ?? []).map((a: any) => ({ at: a.created_at, by: a.actor_name ?? null, kind: String(a.kind ?? "activity"), text: String(a.message ?? "") })),
    ...(notes.data ?? []).map((n: any) => ({ at: n.created_at, by: n.author_name ?? null, kind: "note", text: String(n.body ?? "") })),
    ...(esc.data ?? []).map((e: any) => ({ at: e.created_at, by: null, kind: "escalation", text: `Escalated to ${[e.target, e.contact_name].filter(Boolean).join(" · ")}${e.message ? `: ${e.message}` : ""}${e.acknowledged_at ? ` (acknowledged ${e.acknowledged_at})` : ""}` })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const evidenceIn = (Array.isArray(inc.evidence) ? inc.evidence : []) as any[];
  const { hashStoredFile } = await import("./casefile.server");
  const evidence: CaseEvidence[] = await Promise.all(
    evidenceIn.map(async (ev, i): Promise<CaseEvidence> => {
      const now = await hashStoredFile(supabase, ev.path);
      const receipt: string | null = typeof ev.sha256 === "string" ? ev.sha256 : null;
      return {
        file: `evidence/${String(i + 1).padStart(2, "0")}-${safeName(ev.name ?? "file")}`,
        name: String(ev.name ?? "file"),
        kind: String(ev.kind ?? "document"),
        size: now?.size ?? (typeof ev.size === "number" ? ev.size : null),
        sha256: now?.sha256 ?? null,
        sha256_on_receipt: receipt,
        integrity: !now ? "unreadable" : !receipt ? "no_receipt_fingerprint" : receipt === now.sha256 ? "matches_receipt" : "changed_since_receipt",
        added_at: ev.added_at ?? null,
        added_by: ev.added_by_name ?? null,
        legal_hold: !!ev.legal,
        custody: (Array.isArray(ev.chain_of_custody) ? ev.chain_of_custody : []).map((c: any) => ({ at: c.at, by: c.actor_name ?? null, action: String(c.action ?? ""), note: c.note ?? null })),
      };
    }),
  );
  const record = {
    "Incident code": inc.code,
    Type: String(inc.type ?? "").replace(/_/g, " "),
    Severity: inc.severity,
    Status: inc.status,
    Location: [inc.location, inc.zone, inc.floor].filter(Boolean).join(" · ") || null,
    Coordinates: inc.coord_y != null && inc.coord_x != null ? `${inc.coord_y}, ${inc.coord_x}` : null,
    "Occurred at": inc.occurred_at ?? null,
    "Reported at": inc.reported_at ?? null,
    "Assigned officer": inc.officer ?? null,
    Description: inc.description ?? null,
    "Number of suspects": inc.suspect_count ?? null,
    "Suspect description": inc.suspect_description ?? null,
    "Victim name": inc.victim_name ?? null,
    Witnesses: inc.witnesses ?? null,
  };
  return {
    reference: String(inc.code ?? id),
    title: String(inc.title || `${String(inc.type ?? "Incident").replace(/_/g, " ")} at ${inc.location ?? "unknown location"}`),
    record,
    timeline,
    evidence,
    data_files: [] as { file: string; description: string; content: string; rows: number }[],
  };
}

async function voyageParts(supabase: any, orgId: string, id: string) {
  const { data: v, error } = await supabase.from("movement_voyages").select("*").eq("id", id).eq("organisation_id", orgId).maybeSingle();
  if (error || !v) throwSafeError("casefile.voyage", error ?? new Error("not found"), "Voyage not found.");
  const { data: s } = await supabase.from("movement_subjects").select("name, kind, reference, mmsi, passenger_capacity, life_jackets").eq("id", v.subject_id).maybeSingle();
  const until = v.arrived_at ?? new Date().toISOString();
  const [alertsR, posR, paxR, ckR, hoR, sarR, recR] = await Promise.all([
    supabase.from("movement_alerts").select("id, kind, severity, message, lat, lng, created_at, acknowledged_at, acknowledged_by").eq("voyage_id", id).order("created_at", { ascending: true }).limit(1000),
    v.departed_at
      ? supabase.from("movement_positions").select("recorded_at, received_at, lat, lng, accuracy_m, speed_mps, heading, battery, source").eq("subject_id", v.subject_id).gte("recorded_at", v.departed_at).lte("recorded_at", until).order("recorded_at", { ascending: true }).limit(20000)
      : Promise.resolve({ data: [] }),
    supabase.from("voyage_passengers").select("name, phone, next_of_kin_phone, source, boarded_at").eq("voyage_id", id).order("boarded_at", { ascending: true }).limit(2000),
    supabase.from("movement_checkins").select("created_at, lat, lng, was_overdue").eq("voyage_id", id).order("created_at", { ascending: true }).limit(2000),
    supabase.from("movement_handoffs").select("id, responder_name, distance_m, channel, approved_by_name, created_at, status, first_viewed_at, withdrawn_at, withdrawn_by_name").eq("voyage_id", id).order("created_at", { ascending: true }).limit(100),
    supabase.from("sar_cases").select("id, title, status, created_at, created_by_name, closed_at, outcome").eq("voyage_id", id).order("created_at", { ascending: true }).limit(20),
    supabase.from("voyage_records").select("id, kind, given_by_name, given_by_role, given_by_contact, statement, path, file_name, mime, size_bytes, caption, sha256, taken_at, recorded_by_name, created_at").eq("voyage_id", id).order("taken_at", { ascending: true }).order("id", { ascending: true }).limit(500),
  ]);
  const alerts: any[] = alertsR.data ?? [];
  const rows: any[] = posR.data ?? [];
  const pax: any[] = paxR.data ?? [];
  const checkins: any[] = ckR.data ?? [];
  const handoffs: any[] = hoR.data ?? [];
  const sars: any[] = sarR.data ?? [];
  const records: any[] = recR.data ?? [];
  const alertIds = alerts.map((a) => a.id);
  const handoffIds = handoffs.map((h) => h.id);
  const ackIds = [...new Set(alerts.map((a) => a.acknowledged_by).filter(Boolean))];
  const [delR, hoUpR, ackNamesR] = await Promise.all([
    alertIds.length ? supabase.from("alert_deliveries").select("movement_alert_id, step, channel, recipient_label, status, detail, created_at").in("movement_alert_id", alertIds).order("created_at", { ascending: true }).limit(5000) : Promise.resolve({ data: [] }),
    handoffIds.length ? supabase.from("movement_handoff_updates").select("handoff_id, status, by_name, by_responder, note, created_at").in("handoff_id", handoffIds).order("created_at", { ascending: true }).limit(1000) : Promise.resolve({ data: [] }),
    ackIds.length ? supabase.from("profiles").select("user_id, display_name").in("user_id", ackIds) : Promise.resolve({ data: [] }),
  ]);
  const deliveries: any[] = delR.data ?? [];
  const hoUpdates: any[] = hoUpR.data ?? [];
  const ackName = new Map(((ackNamesR.data ?? []) as any[]).map((p) => [p.user_id, p.display_name]));

  const cell = (x: unknown) => (x == null ? "" : String(x).replace(/[",\n]/g, " "));
  const toCsv = (head: string[], list: unknown[][]) => [head.join(","), ...list.map((r) => r.map(cell).join(","))].join("\n") + "\n";
  const posCsv = toCsv(["recorded_at", "received_at", "lat", "lng", "accuracy_m", "speed_mps", "heading", "battery", "source"], rows.map((r) => [r.recorded_at, r.received_at, r.lat, r.lng, r.accuracy_m, r.speed_mps, r.heading, r.battery, r.source]));
  const crew = (Array.isArray(v.crew) ? v.crew : []) as { name: string; role?: string }[];
  const boarding = v.boarding as null | { checked_at: string; checked_by: string; departure_count: number; life_jackets: number | null; capacity: number | null; qr_passengers: number; weather: string | null; problems: { text: string }[]; override_reason: string | null };
  const label = (k: string) => k.replace(/_/g, " ");

  // ---- Timeline: everything that happened, in order.
  const timeline: CaseTimelineEntry[] = [];
  timeline.push({ at: v.created_at, by: null, kind: "voyage_planned", text: `Voyage planned${v.planned_departure ? ` to leave ${v.planned_departure}` : ""}${v.planned_arrival ? ` and arrive ${v.planned_arrival}` : ""}` });
  for (const p of pax) timeline.push({ at: p.boarded_at, by: null, kind: "boarded", text: `${p.name} boarded (${p.source === "qr" ? "scanned the jetty QR code" : "added by staff"})` });
  if (boarding) timeline.push({ at: boarding.checked_at, by: boarding.checked_by, kind: "boarding_check", text: `Pre-departure check: ${boarding.departure_count} aboard${boarding.capacity != null ? ` of ${boarding.capacity} licensed` : ""}, ${boarding.life_jackets ?? "uncounted"} life jackets${boarding.weather ? `, weather ${boarding.weather}` : ""}${boarding.problems?.length ? `. Problems: ${boarding.problems.map((x) => x.text).join("; ")}` : ". No problems"}${boarding.override_reason ? `. Overridden: ${boarding.override_reason}` : ""}` });
  if (v.departed_at) timeline.push({ at: v.departed_at, by: null, kind: "departed", text: `Departed with ${v.departure_count ?? "an unrecorded number of"} aboard` });
  for (const a of alerts) {
    timeline.push({ at: a.created_at, by: null, kind: a.kind, text: `${a.message} (severity ${a.severity})` });
    if (a.acknowledged_at) timeline.push({ at: a.acknowledged_at, by: ackName.get(a.acknowledged_by) ?? null, kind: "acknowledged", text: `Acknowledged: ${a.message}` });
  }
  const byAlertStep = new Map<string, any[]>();
  for (const d of deliveries) {
    const k = `${d.movement_alert_id}:${d.step}`;
    byAlertStep.set(k, [...(byAlertStep.get(k) ?? []), d]);
  }
  for (const [k, list] of byAlertStep) {
    const a = alerts.find((x) => x.id === k.split(":")[0]);
    const sent = list.filter((d) => d.status === "sent");
    const failed = list.filter((d) => d.status === "failed");
    timeline.push({
      at: list[0].created_at,
      by: null,
      kind: "notified",
      text: `Escalation step ${Number(k.split(":")[1]) + 1} for "${a?.message ?? "alert"}": told ${sent.map((d) => `${d.recipient_label} by ${d.channel.replace("_", "-")}`).join(", ") || "nobody"}${failed.length ? `; failed: ${failed.map((d) => `${d.recipient_label} by ${d.channel}`).join(", ")}` : ""}`,
    });
  }
  for (const c of checkins) timeline.push({ at: c.created_at, by: null, kind: "check_in", text: `All-OK check-in${c.was_overdue ? " (after a missed check-in)" : ""}${c.lat != null ? ` at ${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}` : " (no position)"}` });
  for (const h of handoffs) {
    timeline.push({ at: h.created_at, by: h.approved_by_name ?? null, kind: "handed_off", text: `Handed to ${h.responder_name}${h.distance_m != null ? ` (${(h.distance_m / 1000).toFixed(1)} km away)` : ""} by ${h.channel}` });
    if (h.first_viewed_at) timeline.push({ at: h.first_viewed_at, by: h.responder_name, kind: "responder_opened", text: `${h.responder_name} opened the live link` });
    for (const u of hoUpdates.filter((x) => x.handoff_id === h.id)) if (u.status !== "viewed") timeline.push({ at: u.created_at, by: u.by_name ?? null, kind: `responder_${u.status}`, text: `${u.by_responder ? h.responder_name : "Operator"}: ${label(u.status)}${u.note ? `: ${u.note}` : ""}` });
    if (h.withdrawn_at) timeline.push({ at: h.withdrawn_at, by: h.withdrawn_by_name ?? null, kind: "link_withdrawn", text: `Live link for ${h.responder_name} withdrawn` });
  }
  if (v.hijack_reviewed_at) timeline.push({ at: v.hijack_reviewed_at, by: v.hijack_reviewed_by_name ?? null, kind: "hijack_review", text: `Possible hijack ${v.hijack_review === "confirmed" ? "CONFIRMED" : "dismissed as a false alarm"}${v.hijack_review_note ? `: ${v.hijack_review_note}` : ""}` });
  for (const c of sars) {
    timeline.push({ at: c.created_at, by: c.created_by_name ?? null, kind: "sar_started", text: `Search and rescue plan started: ${c.title}` });
    if (c.closed_at) timeline.push({ at: c.closed_at, by: null, kind: `sar_${c.status}`, text: `Search ${c.status === "found" ? "ended, found" : "stood down"}${c.outcome ? `: ${c.outcome}` : ""}` });
  }
  for (const r of records) timeline.push({ at: r.taken_at, by: r.recorded_by_name ?? null, kind: r.kind === "statement" ? "statement" : "media", text: r.kind === "statement" ? `Statement from ${r.given_by_name}${r.given_by_role ? ` (${r.given_by_role})` : ""}` : `File added: ${r.file_name}${r.caption ? `: ${r.caption}` : ""}` });
  if (v.arrived_at) timeline.push({ at: v.arrived_at, by: null, kind: "arrived", text: `Arrived with ${v.arrival_count ?? "an unrecorded number of"} aboard` });
  timeline.sort((a, b) => a.at.localeCompare(b.at));

  // ---- Plan against what happened.
  const { metres } = await import("./corridor.server");
  const good = rows.filter((r) => r.accuracy_m == null || r.accuracy_m <= 100);
  let travelled = 0;
  for (let i = 1; i < good.length; i++) {
    const d = metres(good[i - 1].lat, good[i - 1].lng, good[i].lat, good[i].lng);
    const dt = (Date.parse(good[i].recorded_at) - Date.parse(good[i - 1].recorded_at)) / 1000;
    if (dt > 0 && d / dt <= 31) travelled += d;
  }
  const route = (Array.isArray(v.route) ? v.route : []) as [number, number][];
  let plannedLen = 0;
  for (let i = 1; i < route.length; i++) plannedLen += metres(route[i - 1][1], route[i - 1][0], route[i][1], route[i][0]);
  const offBy = (lat: number, lng: number) => {
    const kx = 111_320 * Math.cos((lat * Math.PI) / 180), ky = 110_540;
    let best = Infinity;
    for (let i = 1; i < route.length; i++) {
      const ax = (route[i - 1][0] - lng) * kx, ay = (route[i - 1][1] - lat) * ky, bx = (route[i][0] - lng) * kx, by = (route[i][1] - lat) * ky;
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      const t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
    return best;
  };
  let maxOff = 0;
  let outsideS = 0;
  if (route.length > 1) {
    for (let i = 0; i < good.length; i++) {
      const d = offBy(good[i].lat, good[i].lng);
      maxOff = Math.max(maxOff, d);
      if (i && d > v.corridor_m) outsideS += Math.max(0, (Date.parse(good[i].recorded_at) - Date.parse(good[i - 1].recorded_at)) / 1000);
    }
  }
  const mins = (a: string | null, b: string | null) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 60_000) : null);
  const late = (m: number | null) => (m == null ? null : m === 0 ? "on time" : m > 0 ? `${m} min late` : `${-m} min early`);
  const km = (m: number) => `${(m / 1000).toFixed(m < 10_000 ? 2 : 1)} km`;
  const plan_vs_actual: CasePlanRow[] = [
    { item: "Departure", planned: v.planned_departure ?? null, actual: v.departed_at ?? null, note: late(mins(v.planned_departure, v.departed_at)) },
    { item: "Arrival", planned: v.planned_arrival ?? null, actual: v.arrived_at ?? (v.status === "underway" ? "Still under way" : null), note: v.arrived_at ? late(mins(v.planned_arrival, v.arrived_at)) : null },
    { item: "Route length", planned: route.length > 1 ? km(plannedLen) : null, actual: good.length > 1 ? km(travelled) : null, note: route.length > 1 && good.length > 1 ? `${Math.round((travelled / Math.max(plannedLen, 1)) * 100)}% of planned` : null },
    { item: "Furthest from route", planned: route.length > 1 ? `alert corridor ${v.corridor_m} m` : null, actual: route.length > 1 && good.length ? `${Math.round(maxOff)} m` : null, note: outsideS ? `about ${Math.round(outsideS / 60)} min outside the corridor` : route.length > 1 && good.length ? "stayed inside the corridor" : null },
    { item: "People aboard", planned: s?.passenger_capacity != null ? `licensed for ${s.passenger_capacity}` : null, actual: v.departure_count != null ? `${v.departure_count} left${v.arrival_count != null ? `, ${v.arrival_count} arrived` : ""}` : null, note: v.departure_count != null && v.arrival_count != null && v.departure_count !== v.arrival_count ? "HEAD COUNT MISMATCH" : null },
  ];
  const counts: { label: string; value: string }[] = [
    { label: "Licensed capacity", value: s?.passenger_capacity != null ? String(s.passenger_capacity) : "Not recorded" },
    { label: "Life jackets on board", value: boarding?.life_jackets != null ? String(boarding.life_jackets) : s?.life_jackets != null ? String(s.life_jackets) : "Not counted" },
    { label: "Counted at departure", value: v.departure_count != null ? String(v.departure_count) : "Not recorded" },
    { label: "Boarded by QR code", value: String(pax.filter((p) => p.source === "qr").length) },
    { label: "Added by staff", value: String(pax.filter((p) => p.source !== "qr").length) },
    { label: "Crew listed", value: String(crew.length) },
    { label: "Counted at arrival", value: v.arrival_count != null ? String(v.arrival_count) : v.status === "underway" ? "Still under way" : "Not recorded" },
  ];

  // ---- A plain summary built only from the record.
  const serious = alerts.filter((a) => a.severity >= 4);
  const t = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
  const summary = [
    `${s?.name ?? "The boat"} ${v.departed_at ? `left at ${t(v.departed_at)} (Lagos time) with ${v.departure_count ?? "an unrecorded number of"} people aboard` : "had not departed when this file was made"}.`,
    v.arrived_at ? `It arrived at ${t(v.arrived_at)} with ${v.arrival_count ?? "an unrecorded number of"} aboard${v.departure_count != null && v.arrival_count != null && v.departure_count !== v.arrival_count ? `, ${Math.abs(v.departure_count - v.arrival_count)} ${v.arrival_count < v.departure_count ? "fewer" : "more"} than left` : ""}.` : v.departed_at ? "It was still under way when this file was made." : "",
    `${alerts.length} alert${alerts.length === 1 ? " was" : "s were"} raised${serious.length ? `, ${serious.length} of them high or critical (${[...new Set(serious.map((a) => label(a.kind)))].join(", ")})` : ""}.`,
    checkins.length ? `The crew checked in ${checkins.length} time${checkins.length === 1 ? "" : "s"}.` : "",
    handoffs.length ? `It was handed to ${[...new Set(handoffs.map((h) => h.responder_name))].join(", ")}.` : "",
    v.hijack_review ? `A possible hijack was ${v.hijack_review === "confirmed" ? "confirmed" : "reviewed and dismissed"}${v.hijack_reviewed_by_name ? ` by ${v.hijack_reviewed_by_name}` : ""}.` : "",
    sars.length ? `${sars.length} search and rescue plan${sars.length > 1 ? "s were" : " was"} started.` : "",
    records.length ? `${records.filter((r) => r.kind === "statement").length} statement(s) and ${records.filter((r) => r.kind === "media").length} file(s) are attached.` : "",
  ].filter(Boolean).join(" ");

  // ---- Map: planned route, the track (thinned to keep the manifest small), and where alerts were raised.
  const step = Math.max(1, Math.ceil(good.length / 1500));
  const map: CaseMap = {
    route,
    corridor_m: v.corridor_m,
    track: good.filter((_, i) => i % step === 0 || i === good.length - 1).map((r) => [r.lng, r.lat] as [number, number]),
    points: alerts.filter((a) => a.lat != null && a.lng != null).map((a) => ({ lng: a.lng, lat: a.lat, label: label(a.kind), severity: a.severity })),
  };

  // ---- Evidence: attached media (fingerprinted when added, checked again now).
  const { hashStoredFile } = await import("./casefile.server");
  const media = records.filter((r) => r.kind === "media");
  const evidence: CaseEvidence[] = await Promise.all(
    media.map(async (r, i): Promise<CaseEvidence> => {
      const now = await hashStoredFile(supabase, r.path);
      return {
        file: `evidence/${String(i + 1).padStart(2, "0")}-${safeName(r.file_name ?? "file")}`,
        name: String(r.file_name ?? "file"),
        kind: String(r.mime ?? "").startsWith("video/") ? "video" : String(r.mime ?? "").startsWith("image/") ? "photo" : String(r.mime ?? "").startsWith("audio/") ? "audio" : "document",
        size: now?.size ?? r.size_bytes ?? null,
        sha256: now?.sha256 ?? null,
        sha256_on_receipt: r.sha256,
        integrity: !now ? "unreadable" : now.sha256 === r.sha256 ? "matches_receipt" : "changed_since_receipt",
        added_at: r.created_at,
        added_by: r.recorded_by_name ?? null,
        legal_hold: true,
        custody: [{ at: r.created_at, by: r.recorded_by_name ?? null, action: `attached to the voyage${r.caption ? ` (${r.caption})` : ""}`, note: null }],
        record_id: r.id,
      };
    }),
  );

  const { statementText } = await import("./voyage-records");
  const statements = records.filter((r) => r.kind === "statement");
  const data_files = [
    { file: "data/positions.csv", description: "Every position the tracker reported during the voyage, exactly as received", content: posCsv, rows: rows.length },
    { file: "data/passengers.csv", description: "Everyone recorded as boarding, with how they were recorded", content: toCsv(["name", "phone", "next_of_kin_phone", "recorded_by", "boarded_at"], pax.map((p) => [p.name, p.phone, p.next_of_kin_phone, p.source === "qr" ? "jetty QR code" : "staff", p.boarded_at])), rows: pax.length },
    { file: "data/check-ins.csv", description: "Every all-OK check-in from the boat", content: toCsv(["at", "lat", "lng", "after_missed_check_in"], checkins.map((c) => [c.created_at, c.lat, c.lng, c.was_overdue])), rows: checkins.length },
    { file: "data/who-was-told.csv", description: "Every alert message sent while escalating: who, how, and whether it was delivered", content: toCsv(["at", "alert", "step", "channel", "recipient", "status", "detail"], deliveries.map((d) => [d.created_at, alerts.find((a) => a.id === d.movement_alert_id)?.kind ?? "", d.step + 1, d.channel, d.recipient_label, d.status, d.detail])), rows: deliveries.length },
    ...statements.map((r, i) => {
      const text = statementText(r);
      return { file: `statements/${String(i + 1).padStart(2, "0")}-${safeName(r.given_by_name ?? "statement")}.txt`, description: `Statement from ${r.given_by_name}${r.given_by_role ? ` (${r.given_by_role})` : ""}, taken ${r.taken_at}. Fingerprint when recorded: ${r.sha256}`, content: text, rows: 1 };
    }),
  ];

  const record = {
    Voyage: v.name,
    Status: v.status,
    "Boat or vehicle": s ? `${s.name}${s.reference ? ` · ${s.reference}` : ""}` : "Removed",
    MMSI: s?.mmsi ?? null,
    "Planned departure": v.planned_departure ?? null,
    "Actual departure": v.departed_at ?? null,
    "Planned arrival": v.planned_arrival ?? null,
    "Actual arrival": v.arrived_at ?? null,
    "Planned route": route.length >= 2 ? `${route.length} waypoints, alert corridor ${v.corridor_m} m` : null,
    "Head count at departure": v.departure_count ?? null,
    "Head count at arrival": v.arrival_count ?? null,
    "Crew and passengers": crew.length ? crew.map((c) => (c.role ? `${c.name} (${c.role})` : c.name)).join("; ") : null,
    "AIS": s?.mmsi ? "Not stored by Lemtik. Request the AIS history for this MMSI from the authority or an AIS data provider." : "The boat has no MMSI recorded.",
    Notes: v.notes ?? null,
  };
  return {
    reference: String(v.name),
    title: `Voyage: ${v.name}`,
    record,
    timeline,
    evidence,
    data_files,
    maritime: {
      summary,
      plan_vs_actual,
      counts,
      map,
      statements: statements.map((r, i) => ({ file: data_files[4 + i].file, given_by: r.given_by_name, role: r.given_by_role, contact: r.given_by_contact, taken_at: r.taken_at, recorded_by: r.recorded_by_name, sha256: r.sha256, text: r.statement })),
    } as CaseMaritime,
  };
}

async function consignmentParts(supabase: any, orgId: string, id: string) {
  const { data: c, error } = await supabase.from("cargo_consignments").select("*").eq("id", id).eq("organisation_id", orgId).maybeSingle();
  if (error || !c) throwSafeError("casefile.consignment", error ?? new Error("not found"), "Consignment not found.");
  const { data: ev } = await supabase.from("cargo_custody_events").select("*").eq("consignment_id", id).order("seq", { ascending: true }).limit(2000);
  const events: any[] = ev ?? [];
  const { verifyChain, hashCustodyFile } = await import("./cargo.server");
  const chain = verifyChain(events);
  const cps: { name: string }[] = Array.isArray(c.checkpoints) ? c.checkpoints : [];
  const label = (e: any) => `${String(e.kind).replace(/_/g, " ")}${e.checkpoint_index != null && cps[e.checkpoint_index] ? ` at ${cps[e.checkpoint_index].name}` : ""}`;
  const media = events.flatMap((e) => (e.media ?? []).map((m: any) => ({ ...m, seq: e.seq, at: e.recorded_at, by: e.recorded_by_name, what: label(e) })));
  const evidence: CaseEvidence[] = await Promise.all(
    media.map(async (m: any, i: number): Promise<CaseEvidence> => {
      const now = await hashCustodyFile(m.path);
      return {
        file: `evidence/${String(i + 1).padStart(2, "0")}-${safeName(m.name ?? "file")}`,
        name: String(m.name ?? "file"),
        kind: String(m.type ?? "").startsWith("video/") ? "video" : "photo",
        size: now?.size ?? m.size ?? null,
        sha256: now?.sha256 ?? null,
        sha256_on_receipt: m.sha256 ?? null,
        integrity: !now ? "unreadable" : !m.sha256 ? "no_receipt_fingerprint" : m.sha256 === now.sha256 ? "matches_receipt" : "changed_since_receipt",
        added_at: m.at,
        added_by: m.by,
        legal_hold: false,
        custody: [{ at: m.at, by: m.by, action: `attached to custody record ${m.seq} (${m.what})`, note: null }],
      };
    }),
  );
  const cell = (x: unknown) => (x == null ? "" : String(Array.isArray(x) ? x.join(" ") : x).replace(/[",\n]/g, " "));
  const head = "seq,recorded_at,device_at,kind,checkpoint,lat,lng,accuracy_m,off_checkpoint_m,seals_observed,seals_ok,seal_issue,from_party,to_party,note,files,recorded_via,recorded_by,prev_hash,event_hash";
  const csv = [head, ...events.map((e) => [e.seq, e.recorded_at, e.device_at, e.kind, e.checkpoint_index != null ? cps[e.checkpoint_index]?.name ?? e.checkpoint_index : "", e.lat, e.lng, e.accuracy_m, e.off_checkpoint_m, e.seals_observed, e.seals_ok, e.seal_issue, e.from_party, e.to_party, e.note, (e.media ?? []).length, e.recorded_via, e.recorded_by_name, e.prev_hash, e.event_hash].map(cell).join(","))].join("\n") + "\n";
  const timeline: CaseTimelineEntry[] = events.map((e) => ({
    at: e.recorded_at,
    by: e.recorded_by_name,
    kind: e.kind,
    text: [label(e), e.from_party || e.to_party ? `from ${e.from_party ?? "?"} to ${e.to_party ?? "?"}` : "", e.seals_ok === false ? `SEAL MISMATCH: ${e.seal_issue}` : e.seals_ok ? "seals match" : "", e.off_checkpoint_m ? `${e.off_checkpoint_m} m from the checkpoint` : "", e.note ?? ""].filter(Boolean).join(" · "),
  }));
  const record = {
    Reference: c.reference,
    Cargo: c.description,
    Quantity: c.quantity ?? null,
    Containers: (c.container_numbers ?? []).join(", ") || null,
    "Seals on record": (c.seal_numbers ?? []).join(", ") || null,
    From: c.origin,
    To: c.destination,
    Consignee: c.consignee ?? null,
    Carrier: c.carrier ?? null,
    Status: c.status,
    "Delivered at": c.delivered_at ?? null,
    "Custody records": events.length,
    "Hash chain": chain.intact ? `Intact: all ${chain.count} records link to the one before and are unchanged` : `BROKEN at record ${chain.broken_at}: ${chain.reason}`,
    "Last record hash": events.length ? events[events.length - 1].event_hash : null,
  };
  return {
    reference: String(c.reference),
    title: `Chain of custody: ${c.reference} (${c.description})`,
    record,
    timeline,
    evidence,
    data_files: [{ file: "data/custody.csv", description: "Every custody record in order, with each record's hash and the hash of the one before it", content: csv, rows: events.length }],
  };
}

export const createCaseFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ kind: z.enum(["incident", "voyage", "consignment"]), id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const supabase = sb(context);
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { sha256Hex } = await import("./casefile.server");
    const parts = data.kind === "incident" ? await incidentParts(supabase, orgId, data.id) : data.kind === "voyage" ? await voyageParts(supabase, orgId, data.id) : await consignmentParts(supabase, orgId, data.id);
    const [{ data: org }, who] = await Promise.all([supabase.from("organisations").select("name").eq("id", orgId).maybeSingle(), displayName(supabase, context.userId)]);

    const id = crypto.randomUUID();
    const manifest: CaseManifest = {
      format: CASE_FILE_FORMAT,
      case_file_id: id,
      generated_at: new Date().toISOString(),
      generated_by: who,
      organisation: org?.name ?? "",
      kind: data.kind,
      reference: parts.reference,
      title: parts.title,
      record: parts.record,
      timeline: parts.timeline,
      evidence: parts.evidence,
      data_files: parts.data_files.map((f) => ({ file: f.file, description: f.description, sha256: sha256Hex(f.content), rows: f.rows })),
      ...("maritime" in parts && parts.maritime ? { maritime: parts.maritime } : {}),
    };
    const manifestText = JSON.stringify(manifest, null, 2) + "\n";
    const { error } = await supabase.from("case_files").insert({
      id,
      organisation_id: orgId,
      kind: data.kind,
      record_id: data.id,
      reference: parts.reference,
      manifest_text: manifestText,
      manifest_sha256: sha256Hex(manifestText),
      extra_files: parts.data_files.map((f) => ({ file: f.file, content: f.content })),
      file_count: parts.evidence.length + parts.data_files.length,
      generated_by: context.userId,
      generated_by_name: who,
    });
    if (error) throwSafeError("casefile.create", error, "Unable to make the case file. Only managers, operators, client admins and forensic analysts can.");
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: `${data.kind}_case_file`, resourceId: id, actionType: "generate", actionDetail: { record_id: data.id, reference: parts.reference } });
    return { id };
  });

export const getCaseFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const supabase = sb(context);
    const { data: row, error } = await supabase
      .from("case_files")
      .select("id, kind, record_id, reference, manifest_text, manifest_sha256, extra_files, file_count, generated_by_name, created_at")
      .eq("id", data.id)
      .maybeSingle();
    if (error || !row) throwSafeError("casefile.get", error ?? new Error("not found"), "Case file not found.");
    const manifest = JSON.parse(row.manifest_text) as CaseManifest;
    // Signed links so the browser can pull the evidence into the bundle.
    let links: Record<string, string | null> = {};
    if (row.kind === "incident") {
      const { data: inc } = await supabase.from("incidents").select("evidence").eq("id", row.record_id).maybeSingle();
      const items = (Array.isArray(inc?.evidence) ? inc!.evidence : []) as any[];
      const signed = await Promise.all(
        manifest.evidence.map(async (e, i) => {
          const path = items[i]?.path;
          if (!path) return [e.file, null] as const;
          const { data: s } = await supabase.storage.from("incident-evidence").createSignedUrl(path, 3600);
          return [e.file, s?.signedUrl ?? null] as const;
        }),
      );
      links = Object.fromEntries(signed);
    } else if (row.kind === "voyage") {
      const ids = manifest.evidence.map((e) => e.record_id).filter(Boolean) as string[];
      const { data: recs } = ids.length ? await supabase.from("voyage_records").select("id, path").in("id", ids) : { data: [] };
      const pathOf = new Map(((recs ?? []) as { id: string; path: string }[]).map((r) => [r.id, r.path]));
      const signed = await Promise.all(
        manifest.evidence.map(async (e) => {
          const path = e.record_id ? pathOf.get(e.record_id) : undefined;
          if (!path) return [e.file, null] as const;
          const { data: su } = await supabase.storage.from("incident-evidence").createSignedUrl(path, 3600);
          return [e.file, su?.signedUrl ?? null] as const;
        }),
      );
      links = Object.fromEntries(signed);
    } else if (row.kind === "consignment") {
      const { data: ev } = await supabase.from("cargo_custody_events").select("media").eq("consignment_id", row.record_id).order("seq", { ascending: true }).limit(2000);
      const paths: string[] = (ev ?? []).flatMap((e: any) => (e.media ?? []).map((m: any) => m.path));
      const { CUSTODY_BUCKET } = await import("./cargo.server");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: signed } = paths.length ? await (supabaseAdmin as any).storage.from(CUSTODY_BUCKET).createSignedUrls(paths, 3600) : { data: [] };
      links = Object.fromEntries(manifest.evidence.map((e, i) => [e.file, (signed ?? [])[i]?.signedUrl ?? null]));
    }
    return {
      row: row as CaseFileRow,
      manifest,
      extra_files: (row.extra_files ?? []) as { file: string; content: string }[],
      links,
    };
  });

export const listCaseFiles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ kind: z.enum(["incident", "voyage", "consignment"]), record_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows } = await sb(context)
      .from("case_files")
      .select("id, manifest_sha256, file_count, generated_by_name, created_at")
      .eq("kind", data.kind)
      .eq("record_id", data.record_id)
      .order("created_at", { ascending: false })
      .limit(20);
    return (rows ?? []) as { id: string; manifest_sha256: string; file_count: number; generated_by_name: string | null; created_at: string }[];
  });

const VERIFY_LABEL: Record<string, string> = {
  "data/positions.csv": "Position log",
  "data/passengers.csv": "Passenger list",
  "data/check-ins.csv": "Check-in log",
  "data/who-was-told.csv": "Alert delivery log",
  "data/custody.csv": "Chain of custody log",
};

/** Public: lets a court, lawyer or insurer confirm a case file is genuine without logging in. */
export const verifyCaseFile = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await (supabaseAdmin as any)
      .from("case_files")
      .select("id, kind, reference, manifest_text, manifest_sha256, file_count, created_at, organisation_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!row) return { found: false as const };
    const { data: org } = await (supabaseAdmin as any).from("organisations").select("name").eq("id", row.organisation_id).maybeSingle();
    const m = JSON.parse(row.manifest_text) as CaseManifest;
    return {
      found: true as const,
      id: row.id as string,
      kind: row.kind as "incident" | "voyage" | "consignment",
      reference: row.reference as string,
      organisation: (org?.name as string) ?? "",
      generated_at: row.created_at as string,
      manifest_sha256: row.manifest_sha256 as string,
      // Fingerprints only: no names, content or personal details.
      files: [
        ...m.evidence.map((e, i) => ({ label: `Evidence ${i + 1}`, sha256: e.sha256 })),
        ...m.data_files.map((f, i) => ({ label: VERIFY_LABEL[f.file] ?? (f.file.startsWith("statements/") ? `Statement ${f.file.slice(11, 13)}` : m.kind === "consignment" ? "Chain of custody log" : `Data file ${i + 1}`), sha256: f.sha256 })),
      ],
    };
  });

export type CaseAccessEntry = { at: string; who: string | null; email: string | null; action: string; ip: string | null };

/** Records that someone opened, downloaded or printed a case file (the who-viewed log). */
export const logCaseFileAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), action: z.enum(["view", "download_bundle", "print"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row } = await sb(context).from("case_files").select("id, organisation_id, reference").eq("id", data.id).maybeSingle();
    if (!row) throwSafeError("casefile.access", new Error("not found"), "Case file not found.");
    await recordBlackboxAudit({ userId: context.userId, orgId: row.organisation_id, resourceType: "case_file_access", resourceId: row.id, actionType: data.action, actionDetail: { reference: row.reference } });
    return { ok: true };
  });

/** Everyone who generated, opened, downloaded or printed this case file, oldest first. */
export const getCaseFileAccessLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<CaseAccessEntry[]> => {
    const { data: row } = await sb(context).from("case_files").select("id, organisation_id").eq("id", data.id).maybeSingle();
    if (!row) throwSafeError("casefile.access", new Error("not found"), "Case file not found.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await (supabaseAdmin as any)
      .from("audit_log")
      .select("created_at, actor_name, user_email, action_type, ip_address")
      .eq("resource_id", data.id)
      .eq("organisation_id", row.organisation_id)
      .order("created_at", { ascending: true })
      .limit(5000);
    return ((rows ?? []) as any[]).map((r) => ({ at: r.created_at, who: r.actor_name, email: r.user_email, action: r.action_type === "generate" ? "generated" : r.action_type === "download_bundle" ? "downloaded the bundle" : r.action_type === "print" ? "printed or saved as PDF" : r.action_type === "view" ? "opened" : r.action_type, ip: r.ip_address }));
  });
