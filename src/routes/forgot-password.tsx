import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, ArrowLeft } from "lucide-react";
import { AuthLayout } from "@/components/AuthLayout";
import { Notice } from "@/components/nw";

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
    <AuthLayout>
      <div className="col g8">
        <span className="eyebrow">Account recovery</span>
        <h1 style={{ fontSize: 28, fontWeight: 650, fontStretch: "110%", letterSpacing: "-.01em", lineHeight: 1.2 }}>Forgot your password?</h1>
        <p className="t2" style={{ fontSize: 14 }}>
          Enter your work email and we&apos;ll send a reset link. The link expires in 1 hour.
        </p>
      </div>

      {sent ? (
        <Notice tone="ok">
          If an account exists for <strong>{email}</strong>, a password reset link has been sent. Check your inbox.
        </Notice>
      ) : (
        <form onSubmit={submit} className="col g20">
          <div className="fl">
            <label htmlFor="forgot-email">Work email</label>
            <input
              id="forgot-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@yourorganisation.com"
              className="in"
              style={{ height: 42 }}
            />
          </div>
          {error && <Notice tone="fail">{error}</Notice>}
          <button type="submit" disabled={loading} className="b b-pri b-lg w-full" style={{ height: 44 }}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Send reset link
          </button>
        </form>
      )}

      <Link to="/login" search={{ redirect: undefined }} className="lnk row g6 self-start" style={{ fontSize: 12.5 }}>
        <ArrowLeft size={14} strokeWidth={1.75} /> Back to sign in
      </Link>
    </AuthLayout>
  );
}
