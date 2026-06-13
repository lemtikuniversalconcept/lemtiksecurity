import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ShieldHalf, Loader2, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Reset password · Lemtik SOD" }] }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setSent(true);
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
          <h1 className="mt-1 text-xl font-semibold">Forgot password</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Enter your email and we&apos;ll send a reset link. The link expires in 1 hour.
          </p>

          {sent ? (
            <div className="mt-5 rounded-md border border-resolved/40 bg-resolved/10 px-3 py-3 text-xs text-resolved">
              If an account exists for <strong>{email}</strong>, a password reset link has been sent. Check your inbox.
            </div>
          ) : (
            <form onSubmit={submit} className="mt-5 space-y-3">
              <label className="block">
                <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Email</div>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ops@lemtik.com"
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
                Send reset link
              </button>
            </form>
          )}

          <div className="mt-4 text-center">
            <Link to="/login" className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-3 w-3" /> Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
