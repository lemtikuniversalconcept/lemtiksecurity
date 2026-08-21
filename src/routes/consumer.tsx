import { createFileRoute, redirect } from "@tanstack/react-router";
import { ConsumerShell } from "@/components/ConsumerShell";
import { getConsumerToken } from "@/lib/consumer-session";

export const Route = createFileRoute("/consumer")({
  head: () => ({
    meta: [
      { title: "Lemtik Security Emergency" },
      { name: "theme-color", content: "#dc2626" },
    ],
    links: [{ rel: "manifest", href: "/consumer-manifest.webmanifest" }],
  }),
  beforeLoad: () => {
    // This route has no Supabase Auth session — the guest's credential lives only
    // in the browser's localStorage, which doesn't exist during SSR. The fast,
    // synchronous "do we even have a token" check below runs client-side only;
    // the slower network validation (expiry, geofence) happens in consumer.tsx's
    // child routes, where it can show a proper reason instead of a blank redirect.
    if (typeof window === "undefined") return;
    const token = getConsumerToken();
    const onActivate = window.location.pathname.startsWith("/consumer/activate");
    if (!token && !onActivate) {
      throw redirect({ to: "/consumer/activate" });
    }
  },
  component: ConsumerShell,
});
