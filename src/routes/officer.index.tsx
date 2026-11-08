import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Download } from "lucide-react";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import { LemtikMark, Notice } from "@/components/nw";

export const Route = createFileRoute("/officer/")({
  component: OfficerInstallIntro,
});

function OfficerInstallIntro() {
  const { canInstall, isInstalled, promptInstall } = usePwaInstall();
  const [status, setStatus] = useState<string | null>(null);

  const install = async () => {
    const outcome = await promptInstall();
    if (outcome === "accepted") setStatus("Installed. Open Lemtik from your home screen from now on.");
    else if (outcome === "dismissed") setStatus("Not installed. You can add it later from the browser menu.");
  };

  return (
    <div className="col" style={{ maxWidth: 480, margin: "0 auto", minHeight: "100dvh", padding: "48px 20px 32px", gap: 20 }}>
      <LemtikMark size={40} />
      <div className="col g8">
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, lineHeight: 1.15 }}>Put Lemtik on your home screen</h1>
        <p className="t2" style={{ margin: 0, lineHeight: 1.55 }}>
          It opens like an app, keeps you signed in, and saves reports, check-ins and SOS on the phone when there's no signal, then sends them when signal returns.
        </p>
      </div>

      <div className="col g10">
        {isInstalled ? (
          <Notice tone="ok">Lemtik is already installed on this phone.</Notice>
        ) : canInstall ? (
          <button type="button" className="bigbtn" style={{ background: "var(--blue)", color: "#fff" }} onClick={() => void install()}>
            <Download size={18} /> Install Lemtik
          </button>
        ) : (
          <Notice tone="blue">Your browser didn't offer an install button. Open the browser menu and choose "Add to Home Screen".</Notice>
        )}
        {status && <Notice tone="blue">{status}</Notice>}
        <Link to="/officer/home" className="bigbtn" style={{ background: "var(--ink-2)", color: "var(--tx-1)", borderColor: "var(--line-2)" }}>
          Continue in the browser
        </Link>
      </div>

      <div className="o-card col g8">
        <span className="o-lbl">WHAT THE APP WILL ASK FOR</span>
        <span>
          <b>Location</b> <span className="t2">to check you in at patrol stops and send you to incidents. Required.</span>
        </span>
        <span>
          <b>Notifications</b> <span className="t2">so dispatches reach you.</span>
        </span>
        <span>
          <b>Camera and microphone</b> <span className="t2">only when you attach a photo or voice note.</span>
        </span>
      </div>
    </div>
  );
}
