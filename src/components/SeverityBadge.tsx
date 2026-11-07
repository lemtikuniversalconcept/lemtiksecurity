import type { ReactNode } from "react";
import type { Severity } from "@/lib/mockData";
import { Sev, Status } from "@/components/nw";

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <Sev level={severity} label />;
}

export function StatusPill({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "critical" | "resolved" | "high" | "warning" }) {
  const map = { muted: "neutral", critical: "fail", resolved: "ok", high: "warn", warning: "warn" } as const;
  return <Status tone={map[tone]}>{children}</Status>;
}
