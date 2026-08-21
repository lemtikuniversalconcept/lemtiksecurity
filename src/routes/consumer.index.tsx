import { createFileRoute, redirect } from "@tanstack/react-router";
import { getConsumerToken } from "@/lib/consumer-session";

export const Route = createFileRoute("/consumer/")({
  beforeLoad: () => {
    if (typeof window === "undefined") return;
    throw redirect({ to: getConsumerToken() ? "/consumer/home" : "/consumer/activate" });
  },
});
