// Cargo custody: writing and checking the chain of custody (server only).
import { createHash } from "node:crypto";
import { recordBlackboxAudit } from "@/lib/audit.server";

export const CUSTODY_BUCKET = "custody-media";
export const MAX_MEDIA = 4;
export type CustodyKind = "loaded" | "sealed" | "departed" | "checkpoint" | "handover" | "inspection" | "delivered" | "exception";
export type Media = { path: string; name: string; type: string; size: number; sha256: string | null };
export type Checkpoint = { name: string; lat: number; lng: number; radius_m: number };

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}
const sha = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");
export const normSeal = (s: string) => s.trim().toUpperCase().replace(/\s+/g, "");
const iso = (v: string | null) => (v ? new Date(v).toISOString() : null);

/** The exact text each event's hash is taken over. Changing any field, or the order, changes the hash. */
export function eventText(e: any) {
  return JSON.stringify({
    consignment_id: e.consignment_id,
    seq: e.seq,
    kind: e.kind,
    checkpoint_index: e.checkpoint_index ?? null,
    recorded_at: iso(e.recorded_at),
    device_at: iso(e.device_at ?? null),
    lat: e.lat ?? null,
    lng: e.lng ?? null,
    accuracy_m: e.accuracy_m ?? null,
    seals_observed: e.seals_observed ?? [],
    seals_ok: e.seals_ok ?? null,
    seal_issue: e.seal_issue ?? null,
    from_party: e.from_party ?? null,
    to_party: e.to_party ?? null,
    note: e.note ?? null,
    media: (e.media ?? []).map((m: Media) => ({ path: m.path, size: m.size, sha256: m.sha256 })),
    recorded_via: e.recorded_via,
    recorded_by_name: e.recorded_by_name,
    prev_hash: e.prev_hash ?? null,
  });
}
export const eventHash = (e: any) => sha(eventText(e));

/** Recomputes the chain. Returns the first broken link, if any. */
export function verifyChain(events: any[]): { intact: boolean; count: number; broken_at: number | null; reason: string | null } {
  let prev: string | null = null;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.seq !== i + 1) return { intact: false, count: events.length, broken_at: i + 1, reason: `Record ${i + 1} is missing or out of order` };
    if ((e.prev_hash ?? null) !== prev) return { intact: false, count: events.length, broken_at: e.seq, reason: `Record ${e.seq} doesn't follow on from the one before` };
    if (eventHash(e) !== e.event_hash) return { intact: false, count: events.length, broken_at: e.seq, reason: `Record ${e.seq} has been changed since it was written` };
    prev = e.event_hash;
  }
  return { intact: true, count: events.length, broken_at: null, reason: null };
}

export function metres(aLat: number, aLng: number, bLat: number, bLng: number) {
  const r = (v: number) => (v * Math.PI) / 180;
  const h = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

export function mediaPrefix(orgId: string, consignmentId: string) {
  return `${orgId}/${consignmentId}/`;
}

/** A short-lived link the browser uploads one file to, straight into storage. */
export async function uploadUrl(orgId: string, consignmentId: string, name: string) {
  const db = await admin();
  const safe = name.replace(/[^\w.\-]+/g, "_").slice(-80) || "file";
  const path = `${mediaPrefix(orgId, consignmentId)}${crypto.randomUUID()}-${safe}`;
  const { data, error } = await db.storage.from(CUSTODY_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error("Couldn't prepare the upload. Try again.");
  return { path, token: data.token as string };
}

async function fingerprint(db: any, path: string): Promise<{ sha256: string; size: number; type: string } | null> {
  const { data, error } = await db.storage.from(CUSTODY_BUCKET).download(path);
  if (error || !data) return null;
  const bytes = new Uint8Array(await (data as Blob).arrayBuffer());
  return { sha256: sha(bytes), size: bytes.byteLength, type: (data as Blob).type || "application/octet-stream" };
}

export async function hashCustodyFile(path: string) {
  return fingerprint(await admin(), path);
}

export type RecordInput = {
  kind: CustodyKind;
  checkpoint_index: number | null;
  device_at: string | null;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  seals_observed: string[];
  from_party: string | null;
  to_party: string | null;
  note: string | null;
  media: { path: string; name: string }[];
};

/** Appends one event to a consignment's chain. Used by the app and by the driver link. */
export async function appendCustodyEvent(c: any, input: RecordInput, by: { via: "app" | "driver_link"; userId: string | null; name: string }) {
  const db = await admin();
  if (c.status === "cancelled") throw new Error("This consignment was cancelled.");
  if (c.status === "delivered") throw new Error("This consignment has already been delivered.");
  if (input.media.length > MAX_MEDIA) throw new Error(`Up to ${MAX_MEDIA} photos or clips per record.`);
  const prefix = mediaPrefix(c.organisation_id, c.id);
  const media: Media[] = [];
  for (const m of input.media) {
    if (!m.path.startsWith(prefix) || m.path.includes("..")) throw new Error("A file doesn't belong to this consignment.");
    const f = await fingerprint(db, m.path);
    if (!f) throw new Error(`"${m.name}" didn't finish uploading. Try attaching it again.`);
    media.push({ path: m.path, name: m.name.slice(0, 120), type: f.type, size: f.size, sha256: f.sha256 });
  }

  // Seals: compare what's seen with what should be on the cargo. "Sealed" applies new seals.
  const expected: string[] = (c.seal_numbers ?? []).map(normSeal);
  const seen = [...new Set(input.seals_observed.map(normSeal).filter(Boolean))];
  let seals_ok: boolean | null = null;
  let seal_issue: string | null = null;
  if (input.kind !== "sealed" && seen.length && expected.length) {
    const missing = expected.filter((s) => !seen.includes(s));
    const extra = seen.filter((s) => !expected.includes(s));
    seals_ok = !missing.length && !extra.length;
    if (!seals_ok) seal_issue = [missing.length ? `missing or different: ${missing.join(", ")}` : "", extra.length ? `not on record: ${extra.join(", ")}` : ""].filter(Boolean).join("; ");
  }

  let off: number | null = null;
  const cps: Checkpoint[] = Array.isArray(c.checkpoints) ? c.checkpoints : [];
  if (input.checkpoint_index != null) {
    const cp = cps[input.checkpoint_index];
    if (!cp) throw new Error("Checkpoint not found.");
    if (input.lat != null && input.lng != null) {
      const d = metres(input.lat, input.lng, cp.lat, cp.lng);
      if (d > cp.radius_m) off = Math.round(d);
    }
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: last } = await db.from("cargo_custody_events").select("seq, event_hash").eq("consignment_id", c.id).order("seq", { ascending: false }).limit(1).maybeSingle();
    const row: any = {
      organisation_id: c.organisation_id,
      consignment_id: c.id,
      seq: (last?.seq ?? 0) + 1,
      kind: input.kind,
      checkpoint_index: input.checkpoint_index,
      recorded_at: new Date().toISOString(),
      device_at: input.device_at,
      lat: input.lat,
      lng: input.lng,
      accuracy_m: input.accuracy_m,
      off_checkpoint_m: off,
      seals_observed: seen,
      seals_ok,
      seal_issue,
      from_party: input.from_party,
      to_party: input.to_party,
      note: input.note,
      media,
      recorded_via: by.via,
      recorded_by: by.userId,
      recorded_by_name: by.name,
      prev_hash: last?.event_hash ?? null,
    };
    row.event_hash = eventHash(row);
    const { data: ins, error } = await db.from("cargo_custody_events").insert(row).select("id, seq, event_hash").single();
    if (error) {
      if (String(error.code) === "23505") continue; // someone else wrote the next record first
      throw new Error("Couldn't save the record. Try again.");
    }

    const problem = input.kind === "exception" || seals_ok === false;
    const patch: Record<string, unknown> = { last_event_at: row.recorded_at, gap_alerted: false };
    if (input.kind === "sealed" && seen.length) patch.seal_numbers = seen;
    if (["departed", "checkpoint", "handover", "inspection"].includes(input.kind) && c.status === "planned") patch.status = "in_transit";
    if (input.kind === "delivered") Object.assign(patch, { status: "delivered", delivered_at: row.recorded_at });
    if (problem) patch.has_exception = true;
    await db.from("cargo_consignments").update(patch).eq("id", c.id);

    if (problem) {
      await db.from("alerts").insert({
        organisation_id: c.organisation_id, severity: 4, channel: "in-app", channels: ["in-app"], alert_type: "cargo_exception", status: "delivered",
        title: `${c.reference}: ${seals_ok === false ? "seal mismatch" : "custody exception"}`.slice(0, 200),
        body: `${by.name}: ${seal_issue ?? input.note ?? "Exception recorded"}`.slice(0, 1000), action: "Open cargo custody",
        recipients: 1, delivered_count: 1, failed_count: 0, recipient_user_ids: [], acknowledged: false,
      });
    }
    if (by.userId) await recordBlackboxAudit({ userId: by.userId, orgId: c.organisation_id, resourceType: "cargo_custody", resourceId: ins.id, actionType: input.kind, actionDetail: { consignment: c.reference, seq: ins.seq, hash: ins.event_hash, media: media.length } });
    return { seq: ins.seq as number, event_hash: ins.event_hash as string, seals_ok, seal_issue, off_checkpoint_m: off };
  }
  throw new Error("Busy, please try again.");
}

/** Alerts when a consignment in transit has had no custody record for longer than allowed. */
export async function sweepCargo(orgId: string) {
  const db = await admin();
  const { data } = await db.from("cargo_consignments").select("id, reference, last_event_at, max_gap_hours, created_at").eq("organisation_id", orgId).eq("status", "in_transit").eq("gap_alerted", false).limit(500);
  const now = Date.now();
  for (const c of data ?? []) {
    const since = Date.parse(c.last_event_at ?? c.created_at);
    if (now - since < c.max_gap_hours * 3_600_000) continue;
    const { data: flipped } = await db.from("cargo_consignments").update({ gap_alerted: true }).eq("id", c.id).eq("gap_alerted", false).select("id");
    if (!flipped?.length) continue;
    await db.from("alerts").insert({
      organisation_id: orgId, severity: 3, channel: "in-app", channels: ["in-app"], alert_type: "cargo_gap", status: "delivered",
      title: `${c.reference}: no custody record for ${Math.round((now - since) / 3_600_000)} h`, body: `Nothing has been recorded since ${new Date(since).toISOString()}. Check with the driver or carrier.`,
      action: "Open cargo custody", recipients: 1, delivered_count: 1, failed_count: 0, recipient_user_ids: [], acknowledged: false,
    });
  }
}
