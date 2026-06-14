import { severityMeta, type Severity } from "@/lib/mockData";

const colorMap: Record<string, string> = {
  critical: "bg-critical/15 text-critical border-critical/40",
  high: "bg-high/15 text-high border-high/40",
  medium: "bg-medium/15 text-medium border-medium/40",
  low: "bg-low/15 text-low border-low/40",
  resolved: "bg-resolved/15 text-resolved border-resolved/40",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const meta = severityMeta[severity];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${colorMap[meta.token]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full bg-${meta.token}`} style={{ backgroundColor: `var(--${meta.token})` }} />
      S{severity} {meta.label}
    </span>
  );
}

export function StatusPill({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "critical" | "resolved" | "high" }) {
  const toneMap = {
    muted: "bg-muted text-muted-foreground border-border",
    critical: "bg-critical/15 text-critical border-critical/40",
    resolved: "bg-resolved/15 text-resolved border-resolved/40",
    high: "bg-high/15 text-high border-high/40",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium ${toneMap[tone]}`}>
      {children}
    </span>
  );
}
