import type { ReactNode } from "react";

/* Night Watch primitives — thin wrappers over the component classes in styles.css. */

export type SevLevel = 1 | 2 | 3 | 4 | 5;

export const SEV_LABEL: Record<SevLevel, string> = { 5: "Critical", 4: "High", 3: "Medium", 2: "Low", 1: "Minor" };

export function toSev(value: unknown): SevLevel {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 1;
  return Math.min(5, Math.max(1, n)) as SevLevel;
}

export function Sev({ level, label = false, className = "" }: { level: unknown; label?: boolean; className?: string }) {
  const s = toSev(level);
  return (
    <span className={`sv sv${s}${label ? "" : " svq"} ${className}`} title={`Severity ${s} · ${SEV_LABEL[s]}`}>
      <span className="sr-only">Severity </span>
      {s}
      {label ? <span className="lb">{SEV_LABEL[s]}</span> : <span className="sr-only"> {SEV_LABEL[s]}</span>}
    </span>
  );
}

const LIFECYCLE = ["reported", "acknowledged", "responding", "contained", "resolved"] as const;
const STAGE_LABEL: Record<string, string> = {
  reported: "Reported",
  acknowledged: "Acknowledged",
  responding: "Responding",
  contained: "Contained",
  resolved: "Resolved",
  escalated: "Escalated",
  closed: "Closed",
};

export function Lifecycle({ status, label = true }: { status: string | null | undefined; label?: boolean }) {
  const key = (status ?? "reported").toLowerCase();
  const done = key === "resolved" || key === "closed";
  const idx = key === "escalated" ? 2 : Math.max(0, LIFECYCLE.indexOf(key as (typeof LIFECYCLE)[number]));
  return (
    <span className="row g8">
      <span className="lc" aria-hidden="true">
        {LIFECYCLE.map((stage, i) => (
          <i key={stage} className={done ? "dn" : i <= idx ? "on" : undefined} />
        ))}
      </span>
      {label && <span className="t2" style={{ fontSize: 12 }}>{STAGE_LABEL[key] ?? key}</span>}
    </span>
  );
}

/** Confidence is always a bar and a number. Accepts 0–1 or 0–100. */
export function Confidence({ value, size = 12 }: { value: number | null | undefined; size?: number }) {
  if (value == null || !Number.isFinite(value)) return null;
  const pct = Math.round(value <= 1 ? value * 100 : value);
  const on = Math.round(pct / 10);
  return (
    <span className="row g8">
      <span className="cf" aria-hidden="true">
        {Array.from({ length: 10 }, (_, i) => (
          <i key={i} className={i < on ? "on" : undefined} />
        ))}
      </span>
      <span className="mono" style={{ fontSize: size, color: "var(--ai)" }}>{pct}%</span>
    </span>
  );
}

export type Tone = "ok" | "warn" | "fail" | "blue" | "ai" | "off" | "neutral";

/** Status pill: a word plus a dot, never colour alone. */
export function Status({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className="st">
      <span className={`dot${tone === "neutral" ? "" : ` d-${tone}`}`} />
      {children}
    </span>
  );
}

export function Tag({ tone, children, className = "" }: { tone?: Exclude<Tone, "off" | "neutral">; children: ReactNode; className?: string }) {
  return <span className={`tg${tone ? ` tg-${tone}` : ""} ${className}`}>{children}</span>;
}

export function initialsOf(name: string | null | undefined) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  name,
  src,
  size = "sm",
  own = false,
}: {
  name: string | null | undefined;
  src?: string | null;
  size?: "sm" | "lg";
  own?: boolean;
}) {
  return (
    <span className={`av${size === "lg" ? " av-lg" : ""}${own ? " av-b" : ""}`} aria-hidden="true">
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : initialsOf(name)}
    </span>
  );
}

export function PageHeader({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="row g12 wrap">
      <div className="col">
        <h1 className="ph1">{title}</h1>
        {sub ? <span className="sub">{sub}</span> : null}
      </div>
      <span className="flex-auto" />
      {children}
    </div>
  );
}

export function Panel({
  title,
  icon,
  meta,
  actions,
  children,
  className = "",
  bodyClassName = "pn-b",
}: {
  title?: ReactNode;
  icon?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`pn ${className}`}>
      {title !== undefined && (
        <div className="pn-h">
          {icon}
          <h3>{title}</h3>
          {meta ? <span className="meta">{meta}</span> : null}
          {actions ? <span className="ml-auto row g6">{actions}</span> : null}
        </div>
      )}
      {bodyClassName === "" ? children : <div className={bodyClassName}>{children}</div>}
    </section>
  );
}

export function Kpi({ label, icon, value, unit, delta, deltaClass = "" }: {
  label: ReactNode;
  icon?: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  delta?: ReactNode;
  deltaClass?: string;
}) {
  return (
    <div className="kpi">
      <span className="k">{icon}{label}</span>
      <span className="v">
        {value}
        {unit ? <small> {unit}</small> : null}
      </span>
      {delta ? <span className={`d ${deltaClass}`}>{delta}</span> : null}
    </div>
  );
}

export function Seg<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? "on" : undefined} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  tabs,
  onChange,
  label,
  className = "",
}: {
  value: T;
  tabs: { value: T; label: ReactNode; count?: ReactNode }[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div className={`tabs ${className}`} role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={t.value === value}
          className={`tab${t.value === value ? " on" : ""}`}
          onClick={() => onChange(t.value)}
        >
          {t.label}
          {t.count !== undefined ? <span className="c">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`sw${on ? " on" : ""}`}
      onClick={() => onChange(!on)}
    />
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty px-3 py-6 text-center">{children}</div>;
}

export function LemtikMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="ic">
      <path d="M16 2.5 4.5 6.6v8.6c0 7.1 4.8 12.4 11.5 14.6 6.7-2.2 11.5-7.5 11.5-14.6V6.6L16 2.5Z" fill="none" stroke="#3462F0" strokeWidth="2" strokeLinejoin="round" />
      <path d="M16 2.5 4.5 6.6v8.6c0 7.1 4.8 12.4 11.5 14.6V2.5Z" fill="#3462F0" />
      <g fill="#7A9BFF">
        <circle cx="19.6" cy="10" r="1.25" />
        <circle cx="23.6" cy="10" r="1.25" />
        <circle cx="19.6" cy="14.4" r="1.25" />
        <circle cx="23.6" cy="14.4" r="1.25" />
        <circle cx="19.6" cy="18.8" r="1.25" />
        <circle cx="23.2" cy="18.8" r="1.25" />
        <circle cx="19.6" cy="23" r="1.25" />
      </g>
    </svg>
  );
}

export function timeAgo(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return "—";
  const diff = now - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return "—";
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** mm:ss (or h:mm:ss) elapsed since an ISO time — for "open 04:18" style timers. */
export function elapsed(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return "—";
  const total = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
