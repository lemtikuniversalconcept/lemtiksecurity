import { createFileRoute } from "@tanstack/react-router";

/**
 * Called every minute by Supabase Cron (see migration 20261110260000_scheduled_sweep.sql).
 * Runs the alert checks (silent tracker, missed check-in, overdue, curfew, cargo gaps) for
 * every organisation with something to watch, so alerts fire at 3 a.m. with nobody logged in.
 * Requires the x-cron-secret header to equal the CRON_SECRET environment variable.
 */

async function secretOk(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  const got = request.headers.get("x-cron-secret")?.trim() ?? "";
  if (!expected || expected.length < 24 || !got) return false;
  const { createHash, timingSafeEqual } = await import("node:crypto");
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(got).digest();
  return timingSafeEqual(a, b);
}

async function handle(request: Request) {
  if (!(await secretOk(request))) return new Response("Forbidden", { status: 403 });
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const startedAt = new Date();
  const t0 = Date.now();
  let orgs: string[] = [];
  const errors: string[] = [];
  try {
    const [subj, voy, cargo, isps, bcast] = await Promise.all([
      db.from("movement_subjects").select("organisation_id").eq("tracking_enabled", true).limit(5000),
      db.from("movement_voyages").select("organisation_id").eq("status", "underway").limit(5000),
      db.from("cargo_consignments").select("organisation_id").eq("status", "in_transit").limit(5000),
      db.from("isps_facilities").select("organisation_id").limit(5000),
      db.from("isps_broadcasts").select("organisation_id").is("closed_at", null).limit(5000),
    ]);
    const moving = new Set([...(subj.data ?? []), ...(voy.data ?? []), ...(cargo.data ?? [])].map((r: any) => r.organisation_id as string));
    const ispsOrgs = new Set([...(isps.data ?? []), ...(bcast.data ?? [])].map((r: any) => r.organisation_id as string));
    orgs = [...new Set([...moving, ...ispsOrgs])];
    const { sweepOrg } = await import("@/lib/movement.server");
    const { sweepIsps } = await import("@/lib/isps-broadcast.server");
    for (const orgId of orgs) {
      if (Date.now() - t0 > 45_000) {
        errors.push(`time budget reached after ${orgs.indexOf(orgId)} of ${orgs.length} organisations`);
        break;
      }
      if (moving.has(orgId)) {
        try {
          await sweepOrg(orgId);
        } catch (e) {
          errors.push(`${orgId}: ${(e as Error).message}`.slice(0, 300));
        }
      }
      if (ispsOrgs.has(orgId)) {
        try {
          await sweepIsps(orgId);
        } catch (e) {
          errors.push(`${orgId} isps: ${(e as Error).message}`.slice(0, 300));
        }
      }
    }
  } catch (e) {
    errors.push((e as Error).message.slice(0, 300));
  }
  const duration = Date.now() - t0;
  await db.from("system_job_runs").insert({ job: "sweep", started_at: startedAt.toISOString(), duration_ms: duration, orgs_checked: orgs.length, ok: errors.length === 0, error: errors.length ? errors.join(" | ").slice(0, 2000) : null });
  // Keep a week of run history.
  if (startedAt.getUTCMinutes() === 0) await db.from("system_job_runs").delete().lt("started_at", new Date(Date.now() - 7 * 86_400_000).toISOString());
  return Response.json({ ok: errors.length === 0, orgs: orgs.length, ms: duration });
}

export const Route = createFileRoute("/cron/sweep")({
  server: {
    handlers: {
      POST: ({ request }) => handle(request),
    },
  },
});
