import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { throwSafeError } from "@/lib/server-errors";

const uuidSchema = z.string().uuid();

const auditEventSchema = z.union([
  z.object({
    entity: z.literal("patrol"),
    action: z.literal("create"),
    details: z.object({ code: z.string().min(1).max(20), name: z.string().min(1).max(120) }).strict(),
  }),
  z.object({
    entity: z.literal("patrol"),
    action: z.literal("check_in"),
    details: z.object({
      code: z.string().min(1).max(20),
      checked_in: z.number().int().min(0).max(50),
      total: z.number().int().min(1).max(50),
    }).strict(),
  }),
  z.object({
    entity: z.literal("patrol"),
    action: z.literal("status_change"),
    details: z.object({ status: z.enum(["on_route", "delayed", "missed", "complete"]) }).strict(),
  }),
  z.object({
    entity: z.literal("user_role"),
    action: z.literal("assign_role"),
    details: z.object({ role: z.enum(["officer", "supervisor", "manager", "client_admin", "lemtik_admin"]) }).strict(),
  }),
  z.object({
    entity: z.literal("organisation"),
    action: z.enum(["create", "update", "member_add", "member_remove", "member_role_change"]),
    details: z.record(z.string(), z.any()),
  }),
]);

type AuditEventInput = z.input<typeof auditEventSchema> & {
  actorId: string;
  organisationId?: string | null;
  entityId?: string | null;
};

export async function recordAuditEvent(input: AuditEventInput) {
  const actorId = uuidSchema.parse(input.actorId);
  const entityId = input.entityId == null ? null : uuidSchema.parse(input.entityId);
  const organisationId = input.organisationId == null ? null : uuidSchema.parse(input.organisationId);
  const event = auditEventSchema.parse({
    entity: input.entity,
    action: input.action,
    details: input.details,
  });

  const { data: profile } = await supabaseAdmin
    .from("profiles").select("display_name").eq("user_id", actorId).maybeSingle();

  const { error } = await supabaseAdmin.from("audit_log").insert({
    actor_id: actorId,
    actor_name: profile?.display_name ?? null,
    entity: event.entity,
    entity_id: entityId,
    action: event.action,
    details: event.details as Json,
    organisation_id: organisationId,
  });

  if (error) throwSafeError("audit.record", error, "Unable to record audit event.");
}
