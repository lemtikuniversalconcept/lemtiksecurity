import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, CheckCircle2, ArrowLeft } from "lucide-react";
import { AuthLayout } from "@/components/AuthLayout";
import { Notice } from "@/components/nw";

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
  const [linkState, setLinkState] = useState<"checking" | "ready" | "missing">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // The recovery link sets a session via the URL hash. Wait for it.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setReady(true);
        setLinkState("ready");
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setReady(true);
        setLinkState("ready");
      } else {
        setLinkState((current) => (current === "checking" ? "missing" : current));
      }
    });

    const timeout = window.setTimeout(() => {
      setLinkState((current) => (current === "checking" ? "missing" : current));
    }, 6000);

    return () => {
      window.clearTimeout(timeout);
      subscription.unsubscribe();
    };
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
    <AuthLayout>
      <div className="col g8">
        <span className="eyebrow">Account recovery</span>
        <h1 style={{ fontSize: 28, fontWeight: 650, fontStretch: "110%", letterSpacing: "-.01em", lineHeight: 1.2 }}>Set a new password</h1>
        <p className="t2" style={{ fontSize: 14 }}>
          At least 8 characters, with one uppercase letter and one number.
        </p>
      </div>

      {done ? (
        <Notice tone="ok">
          <CheckCircle2 size={15} strokeWidth={2} className="ic mt-px" /> Password updated. Signing you in…
        </Notice>
      ) : linkState === "missing" ? (
        <div className="col g12">
          <Notice tone="warn">This recovery link is missing, expired, or already used. Request a fresh reset email to continue.</Notice>
          <Link to="/forgot-password" className="b b-sec b-lg w-full">
            <ArrowLeft size={15} strokeWidth={1.75} />
            Request a new reset link
          </Link>
        </div>
      ) : !ready ? (
        <div className="row g8 t2" role="status">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking your recovery link…
        </div>
      ) : (
        <form onSubmit={submit} className="col g20">
          <div className="fl">
            <label htmlFor="reset-password">New password</label>
            <input
              id="reset-password"
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="in"
              style={{ height: 42 }}
            />
          </div>
          <div className="fl">
            <label htmlFor="reset-confirm">Confirm password</label>
            <input
              id="reset-confirm"
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="in"
              style={{ height: 42 }}
            />
          </div>
          {error && <Notice tone="fail">{error}</Notice>}
          <button type="submit" disabled={loading} className="b b-pri b-lg w-full" style={{ height: 44 }}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Update password
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
