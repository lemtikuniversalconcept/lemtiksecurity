import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Mail, ArrowLeft } from "lucide-react";
import { verifyGoogleLogin } from "@/lib/users.functions";
import { AuthLayout } from "@/components/AuthLayout";
import { Notice } from "@/components/nw";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in · Lemtik SOD" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: LoginPage,
});

// Only ever follow same-app relative paths back — never an absolute/external URL, and never back into /login itself.
function safeRedirectTarget(path: string | undefined): string | null {
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.startsWith("/login")) return null;
  return path;
}

function LoginPage() {
  const navigate = useNavigate();
  const { redirect: redirectParam } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const checkGoogleLogin = useServerFn(verifyGoogleLogin);

  useEffect(() => {
    let mounted = true;

    const getLandingPath = async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!mounted || !userData.user) return;

      const { data: lemtikAdmin } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userData.user.id)
        .eq("role", "lemtik_admin")
        .maybeSingle();

      if (lemtikAdmin) {
        navigate({ to: safeRedirectTarget(redirectParam) ?? "/app", replace: true });
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("active_organisation_id")
        .eq("user_id", userData.user.id)
        .maybeSingle();

      if (!profile?.active_organisation_id) {
        navigate({ to: "/onboarding", replace: true });
        return;
      }

      const { data: membership } = await supabase
        .from("organisation_members")
        .select("role")
        .eq("organisation_id", profile.active_organisation_id)
        .eq("user_id", userData.user.id)
        .maybeSingle();

      const role = String(membership?.role ?? "officer");
      const fallback =
        role === "officer"
          ? "/officer/home"
          : role === "security_forensic_analyst"
            ? "/forensic"
            : "/app";
      const target = role === "officer" ? fallback : safeRedirectTarget(redirectParam) ?? fallback;
      navigate({ to: target, replace: true });
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) {
        void getLandingPath();
      }
    });
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        void getLandingPath();
      }
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [navigate, redirectParam]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const signInWithGoogle = async () => {
    setError(null);
    const emailHint = email.trim();
    if (!emailHint) {
      setError("Enter your email before continuing with Google sign-in.");
      return;
    }
    setGoogleLoading(true);
    try {
      const result = await checkGoogleLogin({ data: { email: emailHint } });
      if (!result?.exists) {
        setError("No authorised account exists for that email.");
        return;
      }
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/app`,
          queryParams: {
            login_hint: emailHint,
          },
        },
      });
      if (error) {
        setError(error.message);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGoogleLoading(false);
    }
  };

  const sendPasswordReset = async () => {
    const recoveryEmail = email.trim();
    if (!recoveryEmail) {
      setRecoveryMessage("Enter your email first, then request a reset link.");
      setShowRecovery(true);
      return;
    }
    setError(null);
    setRecoveryMessage(null);
    setResetLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(recoveryEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setRecoveryMessage(`If an account exists for ${recoveryEmail}, a reset link has been sent.`);
      setShowRecovery(false);
    } catch (err) {
      setRecoveryMessage((err as Error).message);
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <AuthLayout>
      <div className="col g8">
        <h1 style={{ fontSize: 28, fontWeight: 650, fontStretch: "110%", letterSpacing: "-.01em", lineHeight: 1.2 }}>
          Sign in to your command centre
        </h1>
        <p className="t2" style={{ fontSize: 14 }}>
          Authorised personnel only. Every sign-in is logged.
        </p>
      </div>

      <button type="button" onClick={signInWithGoogle} disabled={loading || googleLoading} className="b b-sec b-lg w-full">
        {googleLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleIcon />}
        Continue with Google
      </button>

      <div className="row g10 t3" style={{ fontSize: 12 }}>
        <span className="hr f1" />
        or
        <span className="hr f1" />
      </div>

      <form onSubmit={submit} className="col g20">
        <div className="fl">
          <label htmlFor="login-email">Work email</label>
          <input
            id="login-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="in"
            style={{ height: 42 }}
            placeholder="you@yourorganisation.com"
          />
        </div>
        <div className="fl">
          <div className="row sb">
            <label htmlFor="login-password">Password</label>
            <button
              type="button"
              className="lnk"
              style={{ fontSize: 12 }}
              aria-expanded={showRecovery}
              onClick={() => {
                setRecoveryMessage(null);
                setShowRecovery((current) => !current);
              }}
            >
              Forgot password?
            </button>
          </div>
          <input
            id="login-password"
            type="password"
            required
            minLength={8}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="in"
            style={{ height: 42 }}
          />
        </div>

        {showRecovery && (
          <div className="card col g8" style={{ padding: "12px 14px" }}>
            <div className="row g8" style={{ fontWeight: 600 }}>
              <Mail size={15} strokeWidth={1.75} className="ic lnk" />
              Send a reset link
            </div>
            <p className="t2" style={{ fontSize: 12.5 }}>
              We&apos;ll email a reset link to the address above.
            </p>
            <div className="row g8">
              <button type="button" onClick={sendPasswordReset} disabled={resetLoading} className="b b-pri f1">
                {resetLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Send reset link
              </button>
              <Link to="/forgot-password" className="b b-sec">
                <ArrowLeft size={14} strokeWidth={1.75} />
                Open page
              </Link>
            </div>
          </div>
        )}

        {recoveryMessage && (
          <Notice tone="ok">{recoveryMessage}</Notice>
        )}

        {error && (
          <Notice tone="fail">{error}</Notice>
        )}

        <button type="submit" disabled={loading} className="b b-pri b-lg w-full" style={{ height: 44 }}>
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          Sign in
        </button>
      </form>

      <p className="t3" style={{ fontSize: 12.5 }}>
        No account? Your security manager adds you. Field officers use this same sign-in and go straight to the officer app.
      </p>
    </AuthLayout>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" className="ic">
      <path fill="#E9EDF5" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3Z" />
      <path fill="#AAB2C4" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z" />
      <path fill="#8790A5" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2L6.4 14Z" />
      <path fill="#C9D1DE" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10C7.2 7.7 9.4 6 12 6Z" />
    </svg>
  );
}
