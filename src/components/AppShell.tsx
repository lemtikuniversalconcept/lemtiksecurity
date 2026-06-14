import { Link, Outlet, useRouterState, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  LayoutDashboard,
  Map,
  AlertTriangle,
  Radar,
  Bell,
  BarChart3,
  Users,
  ShieldHalf,
  Search,
  Radio,
  LogOut,
  History,
  Building2,
  MapPin,
  ChevronDown,
  Plus,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listMyOrgs, switchActiveOrg, getActiveOrg } from "@/lib/orgs.functions";
import { NotificationBell } from "@/components/NotificationBell";

const nav = [
  { to: "/app", label: "Overview", icon: LayoutDashboard, exact: true },
  { to: "/app/map", label: "Live Map", icon: Map },
  { to: "/app/incidents", label: "Incidents", icon: AlertTriangle },
  { to: "/app/patrols", label: "Patrols", icon: Radar },
  { to: "/app/alerts", label: "Alerts", icon: Bell },
  { to: "/app/reports", label: "Reports", icon: BarChart3 },
  { to: "/app/locations", label: "Locations", icon: MapPin },
  { to: "/app/users", label: "Team", icon: Users },
  { to: "/app/org", label: "Organisation", icon: Building2 },
  { to: "/app/audit", label: "Audit", icon: History },
];

export function AppShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [me, setMe] = useState<{ name: string; role: string }>({ name: "Operator", role: "Officer" });
  const [clock, setClock] = useState<string>("");
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const orgMenuRef = useRef<HTMLDivElement>(null);

  const listMine = useServerFn(listMyOrgs);
  const getOrg = useServerFn(getActiveOrg);
  const switchOrg = useServerFn(switchActiveOrg);

  const { data: orgs = [] } = useQuery({ queryKey: ["my-orgs"], queryFn: () => listMine() });
  const { data: activeOrg } = useQuery({ queryKey: ["active-org"], queryFn: () => getOrg() });

  const switchMut = useMutation({
    mutationFn: (id: string) => switchOrg({ data: { organisation_id: id } }),
    onSuccess: () => {
      setOrgMenuOpen(false);
      qc.invalidateQueries();
      navigate({ to: "/app" });
    },
  });

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (orgMenuRef.current && !orgMenuRef.current.contains(e.target as Node)) setOrgMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      const { data: prof } = await supabase
        .from("profiles").select("display_name").eq("user_id", data.user.id).maybeSingle();
      setMe((m) => ({ ...m, name: prof?.display_name || data.user!.email || "Operator" }));
    })();
  }, []);

  useEffect(() => {
    const currentMembership = orgs.find((o) => o.id === activeOrg?.id);
    if (currentMembership) {
      const r = currentMembership.role;
      setMe((m) => ({ ...m, role: r.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase()) }));
    }
  }, [orgs, activeOrg]);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login", replace: true });
  };

  const initials = me.name.split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden md:flex w-64 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="flex items-center gap-2 px-5 py-5 border-b border-sidebar-border">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-primary/15 border border-primary/40">
            <ShieldHalf className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight">LEMTIK</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">SOD v1.0</div>
          </div>
        </div>

        {/* Org switcher */}
        <div ref={orgMenuRef} className="relative px-3 pt-3">
          <button
            onClick={() => setOrgMenuOpen((o) => !o)}
            className="w-full flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2 text-left text-xs hover:bg-surface-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Building2 className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="truncate font-medium">{activeOrg?.name ?? "No organisation"}</span>
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          </button>
          {orgMenuOpen && (
            <div className="absolute left-3 right-3 mt-1 z-30 rounded-md border border-border bg-card shadow-lg p-1 space-y-0.5">
              {orgs.map((o) => (
                <button
                  key={o.id}
                  onClick={() => switchMut.mutate(o.id)}
                  className={`w-full flex items-center justify-between gap-2 rounded px-2 py-1.5 text-xs text-left hover:bg-surface-2 ${
                    o.id === activeOrg?.id ? "bg-primary/10 text-foreground" : "text-muted-foreground"
                  }`}
                >
                  <span className="truncate">{o.name}</span>
                  <span className="text-[9px] uppercase tracking-wider">{o.role.replace("_", " ")}</span>
                </button>
              ))}
              <Link
                to="/onboarding"
                onClick={() => setOrgMenuOpen(false)}
                className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-xs text-primary hover:bg-surface-2 border-t border-border mt-1 pt-2"
              >
                <Plus className="h-3 w-3" /> Create / join another
              </Link>
            </div>
          )}
        </div>

        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {nav.map((item) => {
            const active = item.exact ? pathname === item.to : pathname === item.to || pathname.startsWith(item.to + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-sidebar-accent text-foreground border border-sidebar-border"
                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="px-3 py-3 border-t border-sidebar-border space-y-2">
          <div className="rounded-md bg-surface-2 border border-border p-3">
            <div className="flex items-center gap-2 text-xs">
              <span className="h-2 w-2 rounded-full bg-resolved pulse-dot" />
              <span className="font-medium">Live feed connected</span>
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground font-mono">
              Lagos Ops · <span suppressHydrationWarning>{clock || "--:--"}</span>
            </div>
          </div>
          <button
            onClick={signOut}
            className="flex w-full items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-surface-2"
          >
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-border bg-background/80 backdrop-blur px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="md:hidden">
              <ShieldHalf className="h-5 w-5 text-primary" />
            </div>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                placeholder="Search incidents, officers, zones…"
                className="w-72 max-w-[50vw] rounded-md border border-border bg-surface pl-7 pr-3 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 rounded-md border border-critical/40 bg-critical/10 px-2.5 py-1 text-[11px] text-critical">
              <Radio className="h-3 w-3 pulse-dot" />
              <span className="font-mono uppercase tracking-wider">Live ops</span>
            </div>
            <NotificationBell />
            <div className="flex items-center gap-2">
              <div className="grid h-7 w-7 place-items-center rounded-full bg-accent/20 border border-accent/40 text-[10px] font-bold text-accent">
                {initials || "OP"}
              </div>
              <div className="hidden sm:block leading-tight">
                <div className="text-xs font-medium">{me.name}</div>
                <div className="text-[10px] text-muted-foreground">{me.role}</div>
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
