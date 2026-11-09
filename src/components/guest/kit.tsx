import { useEffect, useState, type ReactNode } from "react";
import { getConsumerSessionMeta } from "@/lib/consumer-session";

/** Languages the guest can choose. Speech accuracy for non-English depends on the guest's own browser. */
export const GUEST_LANGUAGES = [
  { code: "en", label: "English", speechLang: "en-NG" },
  { code: "pcm", label: "Pidgin", speechLang: "en-NG", aiName: "Nigerian Pidgin English" },
  { code: "yo", label: "Yorùbá", speechLang: "yo-NG", aiName: "Yoruba" },
  { code: "ha", label: "Hausa", speechLang: "ha-NG", aiName: "Hausa" },
  { code: "ig", label: "Igbo", speechLang: "ig-NG", aiName: "Igbo" },
] as const;
export type GuestLanguage = (typeof GUEST_LANGUAGES)[number];

const LANG_KEY = "lemtik_consumer_language";

export function useGuestLanguage() {
  const [code, setCode] = useState<string>("en");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LANG_KEY);
      if (saved) setCode(saved);
    } catch {
      /* storage blocked */
    }
  }, []);
  const choose = (next: string) => {
    setCode(next);
    try {
      window.localStorage.setItem(LANG_KEY, next);
    } catch {
      /* storage blocked */
    }
  };
  const language = GUEST_LANGUAGES.find((l) => l.code === code) ?? GUEST_LANGUAGES[0];
  return { language, choose };
}

export function LanguagePicker({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  return (
    <div className="row g6 wrap" role="group" aria-label="Language">
      {GUEST_LANGUAGES.map((l) => (
        <button
          key={l.code}
          type="button"
          aria-pressed={value === l.code}
          onClick={() => onChange(l.code)}
          style={{
            height: 36,
            padding: "0 12px",
            borderRadius: 18,
            fontSize: 14,
            fontWeight: 600,
            border: `1px solid ${value === l.code ? "var(--g-brand)" : "var(--g-line)"}`,
            background: value === l.code ? "var(--g-brand)" : "#fff",
            color: value === l.code ? "#fff" : "var(--g-ink)",
          }}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

export function useOrgName() {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => setName(getConsumerSessionMeta()?.organisationName ?? null), []);
  return name;
}

export function OrgBadge({ right }: { right?: ReactNode }) {
  const name = useOrgName();
  const initials = (name ?? "L")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return (
    <div className="row g10" style={{ padding: "16px 18px" }}>
      <span style={{ width: 40, height: 40, borderRadius: 10, background: "var(--g-brand)", color: "#fff", display: "grid", placeItems: "center", fontWeight: 700 }}>{initials}</span>
      <span className="col f1" style={{ minWidth: 0 }}>
        <b className="trunc" style={{ fontSize: 16 }}>{name ?? "Emergency help"}</b>
        <span style={{ fontSize: 12.5, color: "var(--g-tx3)" }}>Protected by Lemtik</span>
      </span>
      {right}
    </div>
  );
}

export function GNotice({ tone, children }: { tone: "warn" | "fail" | "ok" | "info"; children: ReactNode }) {
  const c = { warn: ["#FFF6DB", "#7A5A00"], fail: ["#FDE8EA", "#9B1C2C"], ok: ["#E6F6EE", "#14633A"], info: ["#EAF0F8", "#1E3A5F"] }[tone];
  return (
    <div role={tone === "fail" ? "alert" : "status"} style={{ background: c[0], color: c[1], borderRadius: 12, padding: "12px 14px", fontSize: 14.5, lineHeight: 1.45 }}>
      {children}
    </div>
  );
}
