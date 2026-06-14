import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { ShieldHalf, Loader2, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Set new password · Lemtik SOD" }] }),
  component: ResetPasswordPage,
});

const passwordSchema = z
  .string()
  .min(8, "At least 8 characters")
  .max(72, "Too long")
  .regex(/[A-Z]/, "Must include an uppercase letter")
  .regex(/[0-9]/, "Must include a number");

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // The recovery link sets a session via the URL hash. Wait for it.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = passwordSchema.safeParse(password);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid password");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      setTimeout(() => navigate({ to: "/app", replace: true }), 1500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center bg-background px-4">
      <div className="w-full max-w-sm">
        <Link to="/" className="flex items-center justify-center gap-2 mb-8">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-primary/15 border border-primary/40">
            <ShieldHalf className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight">LEMTIK</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Security Ops</div>
          </div>
        </Link>

        <div className="rounded-lg border border-border bg-card p-6">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Account recovery</div>
          <h1 className="mt-1 text-xl font-semibold">Set new password</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Must be 8+ characters with one uppercase letter and one number.
          </p>

          {done ? (
            <div className="mt-5 rounded-md border border-resolved/40 bg-resolved/10 px-3 py-3 text-xs text-resolved flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" /> Password updated. Redirecting…
            </div>
          ) : !ready ? (
            <div className="mt-5 text-xs text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Validating recovery link…
            </div>
          ) : (
            <form onSubmit={submit} className="mt-5 space-y-3">
              <label className="block">
                <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">New password</div>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </label>
              <label className="block">
                <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Confirm password</div>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </label>

              {error && (
                <div className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-critical">{error}</div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Update password
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
