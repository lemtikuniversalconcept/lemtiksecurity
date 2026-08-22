const TOKEN_KEY = "lemtik_consumer_token";
const SESSION_META_KEY = "lemtik_consumer_session";

export type ConsumerSessionMeta = {
  sessionId: string;
  organisationName: string;
  expiresAt: string;
  geofence: { lat: number | null; lng: number | null; radius_m: number };
  allowedSsids: string[];
};

export function getConsumerToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setConsumerSession(token: string, meta: ConsumerSessionMeta): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_KEY, token);
  window.localStorage.setItem(SESSION_META_KEY, JSON.stringify(meta));
}

export function getConsumerSessionMeta(): ConsumerSessionMeta | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_META_KEY);
    return raw ? (JSON.parse(raw) as ConsumerSessionMeta) : null;
  } catch {
    return null;
  }
}

export function clearConsumerSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(SESSION_META_KEY);
}

export type PositionResult = {
  lat?: number;
  lng?: number;
  error?: "denied" | "unavailable" | "timeout" | "unsupported";
};

// Silently swallowing every failure here (permission denied, no HTTPS, GPS off) meant
// the geofence check downstream just saw undefined lat/lng and failed as
// "outside_premises" with zero indication that location was ever the problem — the
// caller needs to know WHY it failed so it can tell the guest and offer a retry.
export function getCurrentPositionSafe(): Promise<PositionResult> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ error: "unsupported" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) resolve({ error: "denied" });
        else if (err.code === err.TIMEOUT) resolve({ error: "timeout" });
        else resolve({ error: "unavailable" });
      },
      { enableHighAccuracy: true, timeout: 8_000, maximumAge: 10_000 },
    );
  });
}

const LAST_REPORT_KEY = "lemtik_consumer_last_report_id";

export function getLastReportId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(LAST_REPORT_KEY);
}

export function setLastReportId(reportId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LAST_REPORT_KEY, reportId);
}

const LANGUAGE_KEY = "lemtik_consumer_language";

export function getStoredLanguage(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(LANGUAGE_KEY);
}

export function setStoredLanguage(language: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LANGUAGE_KEY, language);
}
