import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/forensic/")({
  beforeLoad: () => {
    throw redirect({ to: "/forensic/cases" });
  },
});
