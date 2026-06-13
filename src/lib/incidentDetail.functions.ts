import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { throwSafeError } from "@/lib/server-errors";
import { getActiveOrgId } from "@/lib/orgs.server";

const incidentStatus = z.enum([
  "reported", "acknowledged", "responding", "contained", "resolved", "escalated", "closed",
]);

const STATE_FLOW: Record<string, string[]> = {
  reported: ["acknowledged", "escalated"],
  acknowledged: ["responding", "escalated"],
  responding: ["contained", "escalated"],
  contained: ["resolved", "escalated"],
  resolved: ["reported"], // reopen
  escalated: ["closed", "responding"],
  closed: [],
};

async function actorName(supabase: any, userId: string) {
  const { data } = await supabase.from("profiles").select("display_name").eq("user_id", userId).maybeSingle();
  return data?.display_name?.trim() || "Operator";
}

async function logActivity(supabase: any, params: {
  incident_id: string;
  organisation_id: string;
  actor_id: string;
  actor_name: string;
  kind: string;
  message: string;
  meta?: Record<string, unknown>;
}) {
  await supabase.from("incident_activity").insert({
    incident_id: params.incident_id,
    organisation_id: params.organisation_id,
    actor_id: params.actor_id,
    actor_name: params.actor_name,
    kind: params.kind,
    message: params.message,
    meta: params.meta ?? {},
  });
}

// ---------- GET FULL INCIDENT ---------------------------------------------

export const getIncidentDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: incident, error } = await supabase
      .from("incidents").select("*").eq("id", data.id).maybeSingle();
    if (error) throwSafeError("incidents.get", error, "Incident not found.");
    if (!incident) throw new Error("Incident not found.");

    const [activity, notes, escalations, links] = await Promise.all([
      supabase.from("incident_activity").select("*").eq("incident_id", data.id).order("created_at", { ascending: true }),
      supabase.from("incident_notes").select("*").eq("incident_id", data.id).order("created_at", { ascending: true }),
      supabase.from("incident_escalations").select("*").eq("incident_id", data.id).order("created_at", { ascending: false }),
      supabase.from("incident_links").select("linked_incident_id").eq("incident_id", data.id),
    ]);

    let linkedIncidents: any[] = [];
    const linkIds = (links.data ?? []).map((l: any) => l.linked_incident_id);
    if (linkIds.length > 0) {
      const { data: rows } = await supabase
        .from("incidents")
        .select("id, code, type, severity, status, location, zone, reported_at")
        .in("id", linkIds);
      linkedIncidents = rows ?? [];
    }

    // Suggested links: same org, same zone, within 24h, not self/already linked
    const since = new Date(new Date(incident.reported_at).getTime() - 24 * 3600_000).toISOString();
    const until = new Date(new Date(incident.reported_at).getTime() + 24 * 3600_000).toISOString();
    const { data: suggestions } = await supabase
      .from("incidents")
      .select("id, code, type, severity, location, zone, reported_at")
      .eq("organisation_id", incident.organisation_id)
      .eq("zone", incident.zone)
      .gte("reported_at", since)
      .lte("reported_at", until)
      .neq("id", incident.id)
      .limit(10);
    const suggested = (suggestions ?? []).filter((s: any) => !linkIds.includes(s.id));

    // Signed URLs for evidence
    const evidence = Array.isArray(incident.evidence) ? incident.evidence : [];
    const signedEvidence = await Promise.all(
      evidence.map(async (ev: any) => {
        try {
          const { data: signed } = await supabase.storage
            .from("incident-evidence").createSignedUrl(ev.path, 3600);
          return { ...ev, url: signed?.signedUrl ?? null };
        } catch { return { ...ev, url: null }; }
      }),
    );

    return {
      incident: { ...incident, evidence: signedEvidence },
      activity: activity.data ?? [],
      notes: notes.data ?? [],
      escalations: escalations.data ?? [],
      linkedIncidents,
      suggested,
    };
  });

// ---------- STATUS CHANGE (with required note) -----------------------------

export const transitionIncidentStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid(),
    status: incidentStatus,
    note: z.string().min(1).max(500),
    override: z.boolean().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: inc, error: e0 } = await supabase
      .from("incidents").select("status, organisation_id").eq("id", data.id).maybeSingle();
    if (e0) throwSafeError("incidents.transition.read", e0, "Incident not found.");
    if (!inc) throw new Error("Incident not found.");



    const allowed = STATE_FLOW[inc.status] ?? [];
    if (!allowed.includes(data.status) && !data.override) {
      // Require supervisor override
      const { data: mem } = await supabase
        .from("organisation_members").select("role")
        .eq("organisation_id", inc.organisation_id).eq("user_id", userId).maybeSingle();
      const isLeader = mem && ["supervisor", "manager", "client_admin", "lemtik_admin"].includes(mem.role);
      if (!isLeader) {
        throw new Error(`Cannot skip from ${inc.status} to ${data.status}. Supervisor override required.`);
      }
    }

    const { error } = await supabase
      .from("incidents").update({ status: data.status }).eq("id", data.id);
    if (error) throwSafeError("incidents.transition", error, "Unable to update status.");

    const name = await actorName(supabase, userId);
    await logActivity(supabase, {
      incident_id: data.id,
      organisation_id: inc.organisation_id,
      actor_id: userId,
      actor_name: name,
      kind: "status_changed",
      message: `Status: ${inc.status} → ${data.status}. ${data.note}`,
      meta: { from: inc.status, to: data.status, note: data.note },
    });
    return { ok: true };
  });

// ---------- ASSIGN ---------------------------------------------------------

export const reassignIncident = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid(),
    member_user_id: z.string().uuid().nullable(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: inc } = await supabase
      .from("incidents").select("organisation_id, officer").eq("id", data.id).maybeSingle();
    if (!inc) throw new Error("Incident not found.");
    let assignee: string | null = null;
    if (data.member_user_id) {
      const { data: prof } = await supabase
        .from("profiles").select("display_name").eq("user_id", data.member_user_id).maybeSingle();
      assignee = prof?.display_name?.trim() || "Operator";
    }
    const { error } = await supabase
      .from("incidents").update({ officer: assignee }).eq("id", data.id);
    if (error) throwSafeError("incidents.reassign", error, "Unable to reassign.");
    const me = await actorName(supabase, userId);
    await logActivity(supabase, {
      incident_id: data.id,
      organisation_id: inc.organisation_id,
      actor_id: userId,
      actor_name: me,
      kind: "assigned",
      message: assignee ? `Assigned to ${assignee}` : `Unassigned`,
      meta: { from: inc.officer, to: assignee },
    });
    return { ok: true };
  });

// ---------- NOTES ----------------------------------------------------------

export const addIncidentNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    incident_id: z.string().uuid(),
    body: z.string().min(1).max(2000),
    client_visible: z.boolean().optional(),
    mentions: z.array(z.string().uuid()).max(20).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: inc } = await supabase
      .from("incidents").select("organisation_id").eq("id", data.incident_id).maybeSingle();
    if (!inc) throw new Error("Incident not found.");
    const name = await actorName(supabase, userId);
    const { error } = await supabase.from("incident_notes").insert({
      incident_id: data.incident_id,
      organisation_id: inc.organisation_id,
      author_id: userId,
      author_name: name,
      body: data.body,
      client_visible: !!data.client_visible,
      mentions: data.mentions ?? [],
    });
    if (error) throwSafeError("incidents.note", error, "Unable to add note.");
    await logActivity(supabase, {
      incident_id: data.incident_id,
      organisation_id: inc.organisation_id,
      actor_id: userId,
      actor_name: name,
      kind: data.client_visible ? "client_note" : "note",
      message: data.body.slice(0, 200),
    });
    return { ok: true };
  });

// ---------- EVIDENCE -------------------------------------------------------

export const addIncidentEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    incident_id: z.string().uuid(),
    items: z.array(z.object({
      path: z.string().min(1).max(500),
      kind: z.enum(["image", "video", "audio", "document"]),
      size: z.number().int().min(0).max(60_000_000),
      name: z.string().min(1).max(200),
    })).min(1).max(10),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: inc } = await supabase
      .from("incidents").select("organisation_id, evidence").eq("id", data.incident_id).maybeSingle();
    if (!inc) throw new Error("Incident not found.");
    const current = Array.isArray(inc.evidence) ? inc.evidence : [];
    const merged = [...current, ...data.items];
    const { error } = await supabase
      .from("incidents").update({ evidence: merged }).eq("id", data.incident_id);
    if (error) throwSafeError("incidents.evidence", error, "Unable to attach evidence.");
    const name = await actorName(supabase, userId);
    await logActivity(supabase, {
      incident_id: data.incident_id,
      organisation_id: inc.organisation_id,
      actor_id: userId,
      actor_name: name,
      kind: "evidence_added",
      message: `Added ${data.items.length} evidence item(s)`,
      meta: { items: data.items.map((i) => i.name) },
    });
    return { ok: true };
  });

// ---------- LINKS ----------------------------------------------------------

export const linkIncidents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    incident_id: z.string().uuid(),
    linked_incident_id: z.string().uuid(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.incident_id === data.linked_incident_id) throw new Error("Cannot link to self.");
    const orgId = await getActiveOrgId(supabase, userId);
    const { error } = await supabase.from("incident_links").insert({
      organisation_id: orgId,
      incident_id: data.incident_id,
      linked_incident_id: data.linked_incident_id,
      created_by: userId,
    });
    if (error) throwSafeError("incidents.link", error, "Unable to link incidents.");
    // Insert reciprocal (best effort)
    await supabase.from("incident_links").insert({
      organisation_id: orgId,
      incident_id: data.linked_incident_id,
      linked_incident_id: data.incident_id,
      created_by: userId,
    });
    const name = await actorName(supabase, userId);
    await logActivity(supabase, {
      incident_id: data.incident_id,
      organisation_id: orgId,
      actor_id: userId,
      actor_name: name,
      kind: "link_added",
      message: `Linked to incident ${data.linked_incident_id.slice(0, 8)}`,
      meta: { linked_incident_id: data.linked_incident_id },
    });
    return { ok: true };
  });

// ---------- ESCALATIONS ----------------------------------------------------

export const createEscalation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    incident_id: z.string().uuid(),
    target: z.enum(["police", "lasema", "nscdc", "custom"]),
    contact_name: z.string().max(120).optional(),
    contact_phone: z.string().max(40).optional(),
    message: z.string().min(1).max(2000),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: inc } = await supabase
      .from("incidents").select("organisation_id").eq("id", data.incident_id).maybeSingle();
    if (!inc) throw new Error("Incident not found.");
    const { error } = await supabase.from("incident_escalations").insert({
      incident_id: data.incident_id,
      organisation_id: inc.organisation_id,
      target: data.target,
      contact_name: data.contact_name,
      contact_phone: data.contact_phone,
      message: data.message,
      created_by: userId,
    });
    if (error) throwSafeError("incidents.escalate", error, "Unable to create escalation.");
    // Bump status to escalated
    await supabase.from("incidents").update({ status: "escalated" }).eq("id", data.incident_id);
    const name = await actorName(supabase, userId);
    await logActivity(supabase, {
      incident_id: data.incident_id,
      organisation_id: inc.organisation_id,
      actor_id: userId,
      actor_name: name,
      kind: "escalation",
      message: `Escalated to ${data.target.toUpperCase()}`,
      meta: { target: data.target },
    });
    return { ok: true };
  });

export const acknowledgeEscalation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("incident_escalations")
      .update({ acknowledged: true, acknowledged_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throwSafeError("incidents.escalate.ack", error, "Unable to acknowledge.");
    return { ok: true };
  });

// ---------- BULK ACTIONS ---------------------------------------------------

export const bulkUpdateStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    ids: z.array(z.string().uuid()).min(1).max(100),
    status: incidentStatus,
    note: z.string().min(1).max(500),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: rows } = await supabase
      .from("incidents").select("id, status, organisation_id").in("id", data.ids);
    if (!rows?.length) return { ok: true, updated: 0 };
    const { error } = await supabase
      .from("incidents").update({ status: data.status }).in("id", data.ids);
    if (error) throwSafeError("incidents.bulkStatus", error, "Bulk update failed.");
    const name = await actorName(supabase, userId);
    await Promise.all(rows.map((r: any) => logActivity(supabase, {
      incident_id: r.id,
      organisation_id: r.organisation_id,
      actor_id: userId,
      actor_name: name,
      kind: "status_changed",
      message: `Bulk: ${r.status} → ${data.status}. ${data.note}`,
      meta: { from: r.status, to: data.status, bulk: true, note: data.note },
    })));
    return { ok: true, updated: rows.length };
  });

export const bulkAssign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    ids: z.array(z.string().uuid()).min(1).max(100),
    member_user_id: z.string().uuid().nullable(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let assignee: string | null = null;
    if (data.member_user_id) {
      const { data: prof } = await supabase
        .from("profiles").select("display_name").eq("user_id", data.member_user_id).maybeSingle();
      assignee = prof?.display_name?.trim() || "Operator";
    }
    const { data: rows } = await supabase
      .from("incidents").select("id, organisation_id, officer").in("id", data.ids);
    if (!rows?.length) return { ok: true, updated: 0 };
    const { error } = await supabase
      .from("incidents").update({ officer: assignee }).in("id", data.ids);
    if (error) throwSafeError("incidents.bulkAssign", error, "Bulk assign failed.");
    const me = await actorName(supabase, userId);
    await Promise.all(rows.map((r: any) => logActivity(supabase, {
      incident_id: r.id,
      organisation_id: r.organisation_id,
      actor_id: userId,
      actor_name: me,
      kind: "assigned",
      message: assignee ? `Bulk assigned to ${assignee}` : `Bulk unassigned`,
      meta: { from: r.officer, to: assignee, bulk: true },
    })));
    return { ok: true, updated: rows.length };
  });
