import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { orgKind } from "./rbac";
import { throwSafeError } from "./server-errors";
import { effectiveFeatures, FEATURE_LABEL, type Feature } from "./features";

/** Throws a plain-English error when a module is switched off for the organisation. */
export async function assertFeature(orgId: string, feature: Feature) {
  const { data } = await (supabaseAdmin as any).from("organisations").select("type, features").eq("id", orgId).maybeSingle();
  if (!data) throw new Error("Organisation not found.");
  if (!effectiveFeatures(orgKind(data.type), data.features).includes(feature)) {
    throwSafeError("feature", new Error(`${feature} off`), `${FEATURE_LABEL[feature].split(" (")[0]} isn't switched on for your organisation. Contact Lemtik to add it.`);
  }
}

/** True when the module is on for the organisation. */
export async function hasFeature(orgId: string, feature: Feature) {
  const { data } = await (supabaseAdmin as any).from("organisations").select("type, features").eq("id", orgId).maybeSingle();
  return !!data && effectiveFeatures(orgKind(data.type), data.features).includes(feature);
}
