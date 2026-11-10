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
};
export type CaseTimelineEntry = { at: string; by: string | null; kind: string; text: string };
export type CaseManifest = {
  format: typeof CASE_FILE_FORMAT;
  case_file_id: string;
  generated_at: string;
  generated_by: string;
  organisation: string;
  kind: "incident" | "voyage";
  reference: string;
  title: string;
  record: Record<string, string | number | boolean | null>;
  timeline: CaseTimelineEntry[];
  evidence: CaseEvidence[];
  data_files: { file: string; description: string; sha256: string; rows: number }[];
};
export type CaseFileRow = {
  id: string;
  kind: "incident" | "voyage";
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
  const { data: s } = await supabase.from("movement_subjects").select("name, kind, reference, mmsi").eq("id", v.subject_id).maybeSingle();
  const { data: alerts } = await supabase.from("movement_alerts").select("kind, severity, message, created_at, acknowledged_at").eq("voyage_id", id).order("created_at", { ascending: true }).limit(1000);
  let rows: any[] = [];
  if (v.departed_at) {
    const { data } = await supabase
      .from("movement_positions")
      .select("recorded_at, received_at, lat, lng, accuracy_m, speed_mps, heading, battery, source")
      .eq("subject_id", v.subject_id)
      .gte("recorded_at", v.departed_at)
      .lte("recorded_at", v.arrived_at ?? new Date().toISOString())
      .order("recorded_at", { ascending: true })
      .limit(20000);
    rows = data ?? [];
  }
  const cell = (x: unknown) => (x == null ? "" : String(x).replace(/[",\n]/g, " "));
  const csv = ["recorded_at,received_at,lat,lng,accuracy_m,speed_mps,heading,battery,source", ...rows.map((r) => [r.recorded_at, r.received_at, r.lat, r.lng, r.accuracy_m, r.speed_mps, r.heading, r.battery, r.source].map(cell).join(","))].join("\n") + "\n";
  const crew = (Array.isArray(v.crew) ? v.crew : []) as { name: string; role?: string }[];
  const timeline: CaseTimelineEntry[] = (alerts ?? []).map((a: any) => ({
    at: a.created_at,
    by: null,
    kind: a.kind,
    text: `${a.message}${a.acknowledged_at ? ` (acknowledged ${a.acknowledged_at})` : a.severity >= 3 ? " (not acknowledged)" : ""}`,
  }));
  const record = {
    Voyage: v.name,
    Status: v.status,
    "Boat or vehicle": s ? `${s.name}${s.reference ? ` · ${s.reference}` : ""}` : "Removed",
    MMSI: s?.mmsi ?? null,
    "Planned departure": v.planned_departure ?? null,
    "Actual departure": v.departed_at ?? null,
    "Planned arrival": v.planned_arrival ?? null,
    "Actual arrival": v.arrived_at ?? null,
    "Planned route": Array.isArray(v.route) && v.route.length >= 2 ? `${v.route.length} waypoints, alert corridor ${v.corridor_m} m` : null,
    "Head count at departure": v.departure_count ?? null,
    "Head count at arrival": v.arrival_count ?? null,
    "Crew and passengers": crew.length ? crew.map((c) => (c.role ? `${c.name} (${c.role})` : c.name)).join("; ") : null,
    Notes: v.notes ?? null,
  };
  return {
    reference: String(v.name),
    title: `Voyage: ${v.name}`,
    record,
    timeline,
    evidence: [] as CaseEvidence[],
    data_files: [{ file: "data/positions.csv", description: "Every position the tracker reported during the voyage, exactly as received", content: csv, rows: rows.length }],
  };
}

export const createCaseFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ kind: z.enum(["incident", "voyage"]), id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const supabase = sb(context);
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { sha256Hex } = await import("./casefile.server");
    const parts = data.kind === "incident" ? await incidentParts(supabase, orgId, data.id) : await voyageParts(supabase, orgId, data.id);
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
  .inputValidator((d: unknown) => z.object({ kind: z.enum(["incident", "voyage"]), record_id: z.string().uuid() }).parse(d))
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
      kind: row.kind as "incident" | "voyage",
      reference: row.reference as string,
      organisation: (org?.name as string) ?? "",
      generated_at: row.created_at as string,
      manifest_sha256: row.manifest_sha256 as string,
      // Fingerprints only: no names, content or personal details.
      files: [
        ...m.evidence.map((e, i) => ({ label: `Evidence ${i + 1}`, sha256: e.sha256 })),
        ...m.data_files.map((f, i) => ({ label: m.kind === "voyage" ? "Position log" : `Data file ${i + 1}`, sha256: f.sha256 })),
      ],
    };
  });
