import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Bell, FileText, Home, Route as RouteIcon, Siren, Sun, Moon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useMyNotifications } from "@/components/officer/kit";

const DAYLIGHT_KEY = "lemtik.officer.daylight";

/**
 * The officer app is a phone app: one narrow column with a thumb-reach tab bar. On a desktop it
 * stays phone-width so supervisors see exactly what officers see.
 */
export function OfficerShell({ children }: { children?: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: notifications = [] } = useMyNotifications();
  const unread = notifications.filter((n) => !n.read).length;
  const [daylight, setDaylight] = useState(false);

  useEffect(() => {
    try {
      setDaylight(window.localStorage.getItem(DAYLIGHT_KEY) === "1");
    } catch {
      /* storage blocked: default to night */
    }
  }, []);
  const toggleDaylight = () => {
    setDaylight((d) => {
      try {
        window.localStorage.setItem(DAYLIGHT_KEY, d ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !d;
    });
  };

  const isOn = (to: string) => pathname === to || pathname.startsWith(`${to}/`);
  const tabs = [
    { to: "/officer/home", label: "Home", icon: Home },
    { to: "/officer/patrol", label: "Patrol", icon: RouteIcon },
    { to: "/officer/sos", label: "SOS", icon: Siren, sos: true },
    { to: "/officer/incident/new", label: "Report", icon: FileText },
    { to: "/officer/notifications", label: "Alerts", icon: Bell, badge: unread },
  ] as const;

  // The install intro is a full page of its own, without the tab bar.
  if (pathname === "/officer" || pathname === "/officer/") {
    return <div className={`min-h-screen ${daylight ? "light" : ""}`} style={{ background: "var(--ink-0)", color: "var(--tx-1)" }}>{children ?? <Outlet />}</div>;
  }

  return (
    <div className={daylight ? "light" : ""} style={{ background: "var(--ink-0)", color: "var(--tx-1)", minHeight: "100dvh" }}>
      <div className="col" style={{ maxWidth: 480, margin: "0 auto", minHeight: "100dvh", borderLeft: "1px solid var(--line-1)", borderRight: "1px solid var(--line-1)", background: "var(--ink-0)" }}>
        <main className="col f1" style={{ paddingBottom: 76 }}>
          {children ?? <Outlet />}
        </main>
        <nav className="tapbar" aria-label="Officer app" style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, zIndex: 40 }}>
          {tabs.map((t) => {
            const Icon = t.icon;
            const on = isOn(t.to);
            return (
              <Link key={t.to} to={t.to} className={`${on ? "on" : ""}${"sos" in t && t.sos ? " sos" : ""}`} aria-current={on ? "page" : undefined}>
                <span className="ic relative" style={{ display: "inline-flex" }}>
                  <Icon size={22} strokeWidth={"sos" in t && t.sos ? 2.4 : 1.8} />
                  {"badge" in t && t.badge ? (
                    <span className="badge" style={{ position: "absolute", top: -6, right: -10, minWidth: 16, height: 16, borderRadius: 8, background: "var(--s5)", color: "#0A0C10", font: "700 10px/16px var(--m)", textAlign: "center", padding: "0 4px" }}>
                      {t.badge > 9 ? "9+" : t.badge}
                    </span>
                  ) : null}
                </span>
                {t.label}
              </Link>
            );
          })}
        </nav>
        <button
          type="button"
          onClick={toggleDaylight}
          className="ibtn"
          aria-label={daylight ? "Switch to night mode" : "Switch to daylight mode"}
          title={daylight ? "Night mode" : "Daylight mode (easier to read in sun)"}
          style={{ position: "fixed", right: "max(12px, calc(50% - 240px + 12px))", bottom: 84, zIndex: 41, width: 36, height: 36, borderRadius: 18 }}
        >
          {daylight ? <Moon size={16} /> : <Sun size={16} />}
        </button>
      </div>
    </div>
  );
}
