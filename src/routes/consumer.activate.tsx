import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { GNotice, LanguagePicker, OrgBadge, useGuestLanguage } from "@/components/guest/kit";
import { activateConsumerSession } from "@/lib/consumer.functions";
import { setConsumerSession, clearConsumerSession, getCurrentPositionSafe } from "@/lib/consumer-session";

const REASON_MESSAGES: Record<string, string> = {
  invalid_token: "This code is not valid. Please ask reception for a new one.",
  expired: "This code has expired. Please ask reception for a new one.",
  deactivated: "This code is no longer active. Please ask reception for a new one.",
  outside_premises: "This code only works on the premises. Please try again once you're inside.",
};

const LOCATION_ERROR_MESSAGES: Record<string, string> = {
  denied: "We need your location to confirm you're on the premises. Please allow location access in your browser settings, then try again.",
  timeout: "Could not get your location in time. Please try again.",
  unavailable: "Could not determine your location. Please try again.",
  unsupported: "Your browser doesn't support location. Please ask reception for help.",
};

export const Route = createFileRoute("/consumer/activate")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : undefined,
    reason: typeof search.reason === "string" ? search.reason : undefined,
  }),
  component: ActivatePage,
});

function ActivatePage() {
  const { token: tokenFromUrl, reason } = Route.useSearch();
  const navigate = useNavigate();
  const activate = useServerFn(activateConsumerSession);
  const [tokenInput, setTokenInput] = useState(tokenFromUrl || "");
  const [status, setStatus] = useState<"idle" | "activating" | "error">("idle");
  const [error, setError] = useState<string | null>(reason ? REASON_MESSAGES[reason] || null : null);
  const { language, choose } = useGuestLanguage();

  useEffect(() => {
    if (reason && reason !== "outside_premises") clearConsumerSession();
  }, [reason]);

  const doActivate = async (rawToken: string) => {
    const token = rawToken.trim().toUpperCase();
    if (!token) return;
    setStatus("activating");
    setError(null);
    try {
      const position = await getCurrentPositionSafe();
      const result = await activate({
        data: { token, device_lat: position.lat, device_lng: position.lng },
      });
      if (!result.valid) {
        setStatus("error");
        // A geofence rejection when we never actually got a location reading is really
        // a location-permission problem wearing an "outside_premises" costume — tell
        // the guest the true, actionable reason instead of the confusing generic one.
        if (result.reason === "outside_premises" && position.error) {
          setError(LOCATION_ERROR_MESSAGES[position.error]);
        } else {
          setError(REASON_MESSAGES[result.reason] || "Could not activate this code. Please try again.");
        }
        return;
      }
      setConsumerSession(token, {
        sessionId: result.session_id,
        organisationName: result.organisation_name,
        expiresAt: result.expires_at,
        geofence: result.geofence,
        allowedSsids: result.allowed_ssids,
      });
      navigate({ to: "/consumer/home" });
    } catch {
      setStatus("error");
      setError("Could not connect. Please check your internet connection and try again.");
    }
  };

  useEffect(() => {
    if (tokenFromUrl) void doActivate(tokenFromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenFromUrl]);

  return (
    <div className="col f1">
      <OrgBadge />
      <div className="col g20" style={{ padding: "8px 20px 32px", gap: 20 }}>
        <div className="col g8">
          <h1 style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.2, margin: 0 }}>Reach security in an emergency</h1>
          <p style={{ margin: 0, color: "var(--g-tx2)", fontSize: 16, lineHeight: 1.5 }}>
            Enter the code you were given at check-in. Nothing is shared until you ask for help.
          </p>
        </div>
        {status === "activating" ? (
          <div className="row g8" style={{ color: "var(--g-tx2)", fontSize: 16 }}>
            <Loader2 size={18} className="animate-spin" /> Checking your code…
          </div>
        ) : (
          <form
            className="col g12"
            onSubmit={(e) => {
              e.preventDefault();
              void doActivate(tokenInput);
            }}
          >
            <label className="col g8">
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--g-tx2)" }}>Your code</span>
              <input
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value.toUpperCase())}
                placeholder="LMT-XXXXXXXXXX"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
                style={{ height: 56, borderRadius: 14, border: "1px solid var(--g-line)", background: "#fff", padding: "0 16px", fontSize: 20, fontFamily: "var(--m)", letterSpacing: ".06em", color: "var(--g-ink)", textAlign: "center" }}
              />
            </label>
            <div className="col g8">
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--g-tx2)" }}>Language</span>
              <LanguagePicker value={language.code} onChange={choose} />
            </div>
            <button type="submit" disabled={!tokenInput.trim()} style={{ height: 56, borderRadius: 14, border: 0, background: "var(--g-brand)", color: "#fff", fontSize: 17, fontWeight: 700, opacity: tokenInput.trim() ? 1 : 0.45 }}>
              Continue
            </button>
          </form>
        )}
        {error && <GNotice tone="fail">{error}</GNotice>}
        <p style={{ margin: 0, color: "var(--g-tx3)", fontSize: 13 }}>The code works on these premises for your stay only. We check your location once to confirm you're on site.</p>
      </div>
    </div>
  );
}
