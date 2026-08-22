import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
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
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-10 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-full bg-red-600/15 text-red-500">
        <ShieldAlert className="h-8 w-8" />
      </div>
      <div>
        <h1 className="text-xl font-semibold">Emergency reporting</h1>
        <p className="mt-1 text-sm text-slate-400">Enter the code given to you at check-in.</p>
      </div>

      {status === "activating" ? (
        <div className="flex items-center gap-2 text-sm text-slate-300">
          <Loader2 className="h-4 w-4 animate-spin" /> Connecting…
        </div>
      ) : (
        <form
          className="flex w-full max-w-xs flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void doActivate(tokenInput);
          }}
        >
          <input
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value.toUpperCase())}
            placeholder="LMT-XXXXXXXXXX"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-4 text-center text-lg font-mono tracking-wider text-white placeholder:text-slate-500 focus:border-red-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!tokenInput.trim()}
            className="w-full rounded-xl bg-red-600 px-4 py-4 text-base font-semibold text-white transition-colors hover:bg-red-500 disabled:opacity-40"
          >
            Continue
          </button>
        </form>
      )}

      {error && <p className="max-w-xs text-sm text-red-400">{error}</p>}
    </div>
  );
}
