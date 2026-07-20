import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getActiveOrgId } from "@/lib/orgs.server";
import { requestRelationshipApi } from "@/lib/relationship-api";

export type CameraRecord = {
  id: string;
  name: string;
  location: string;
  status: "online" | "offline" | "degraded";
  streamLabel?: string | null;
  lastSeenAt?: string | null;
};

const cameraInput = z.object({
  camera_id: z.string().min(1),
});

export const listCameras = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const result = await requestRelationshipApi<CameraRecord[]>("/api/v1/cameras", {
      method: "GET",
      query: { org_id: orgId },
    });
    return result ?? [];
  });

export const startCameraStream = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => cameraInput.parse(data))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const result = await requestRelationshipApi<{ stream_url?: string | null; stream_id?: string | null; status?: string }>("/api/v1/streams/start", {
      body: { org_id: orgId, camera_id: data.camera_id, source: "c4isod-dashboard" },
    });
    return result ?? { stream_url: null, stream_id: null, status: "unavailable" };
  });

