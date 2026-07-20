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
  Video,
  LogOut,
  History,
  Building2,
  ReceiptText,
  MapPin,
  ChevronDown,
  Plus,
  ServerCrash,
  ShieldAlert,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listMyOrgs, switchActiveOrg, getActiveOrg } from "@/lib/orgs.functions";
import { NotificationBell } from "@/components/NotificationBell";
import type { AppAccess, SpecRole } from "@/lib/rbac";

const nav = [
  { to: "/app", label: "Overview", icon: LayoutDashboard, exact: true, allowed: ["security_manager", "operator", "client_admin"] as SpecRole[] },
  { to: "/app/map", label: "Live Map", icon: Map, allowed: ["security_manager", "operator", "client_admin"] as SpecRole[] },
  { to: "/app/cctv", label: "CCTV Room", icon: Video, allowed: ["security_manager", "operator"] as SpecRole[] },
  { to: "/app/incidents", label: "Incidents", icon: AlertTriangle, allowed: ["security_manager", "operator", "client_admin"] as SpecRole[] },
  { to: "/app/patrols", label: "Patrols", icon: Radar, allowed: ["security_manager", "operator", "client_admin"] as SpecRole[] },
  { to: "/app/intelligence", label: "Intelligence", icon: ShieldAlert, allowed: ["security_manager", "operator", "client_admin"] as SpecRole[] },
  { to: "/app/inventory", label: "Inventory", icon: MapPin, allowed: ["security_manager", "operator", "client_admin"] as SpecRole[] },
  { to: "/app/alerts", label: "Alerts", icon: Bell, allowed: ["security_manager", "operator"] as SpecRole[] },
  { to: "/app/reports", label: "Analytics", icon: BarChart3, allowed: ["security_manager", "operator", "client_admin"] as SpecRole[] },
  { to: "/app/report-centre", label: "Report Centre", icon: ReceiptText, allowed: ["security_manager", "operator", "client_admin"] as SpecRole[] },
  { to: "/app/locations", label: "Locations", icon: MapPin, allowed: ["security_manager", "client_admin"] as SpecRole[] },
  { to: "/app/users", label: "Team", icon: Users, allowed: ["security_manager", "client_admin"] as SpecRole[] },
  { to: "/app/org", label: "Organisation", icon: Building2, allowed: ["security_manager", "client_admin"] as SpecRole[] },
  { to: "/app/audit", label: "Audit", icon: History, allowed: ["security_manager", "client_admin"] as SpecRole[] },
];

export function AppShell({ access }: { access: AppAccess }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [me, setMe] = useState<{ name: string; role: string }>({
    name: "Operator",
    role: access.roleLabel,
  });
  const [clock, setClock] = useState<string>("");
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const orgMenuRef = useRef<HTMLDivElement>(null);

  const listMine = useServerFn(listMyOrgs);
  const getOrg = useServerFn(getActiveOrg);
  const switchOrg = useServerFn(switchActiveOrg);
  const orgQueriesEnabled = access.specRole !== "lemtik_admin";

  const { data: orgs = [] } = useQuery({ queryKey: ["my-orgs"], queryFn: () => listMine(), enabled: orgQueriesEnabled });
  const { data: activeOrg } = useQuery({ queryKey: ["active-org"], queryFn: () => getOrg(), enabled: orgQueriesEnabled });

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
    setMe((m) => ({ ...m, role: access.roleLabel }));
  }, [access.roleLabel]);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login", replace: true });
  };

  const initials = me.name.split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase();
  const visibleNav = nav.filter((item) => item.allowed.includes(access.specRole));

  if (access.specRole === "lemtik_admin") {
    return (
      <div className="flex min-h-screen bg-background text-foreground">
        <aside className="hidden md:flex w-64 flex-col border-r border-sidebar-border bg-sidebar">
          <div className="flex items-center gap-2 px-5 py-5 border-b border-sidebar-border">
            <div className="grid h-9 w-9 place-items-center rounded-md bg-primary/15 border border-primary/40">
              <ShieldHalf className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight">LEMTIK</div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Platform Admin</div>
            </div>
          </div>

          <nav className="flex-1 px-2 py-3 space-y-0.5">
            <Link
              to="/app"
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                pathname === "/app"
                  ? "bg-sidebar-accent text-foreground border border-sidebar-border"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              }`}
            >
              <LayoutDashboard className="h-4 w-4" />
              Platform dashboard
              </Link>
            <Link
              to="/app/admin/billing"
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                pathname.startsWith("/app/admin/billing")
                  ? "bg-sidebar-accent text-foreground border border-sidebar-border"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              }`}
            >
              <ReceiptText className="h-4 w-4" />
              Billing
            </Link>
            <Link
              to="/app/admin/organisations"
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                pathname.startsWith("/app/admin/organisations")
                  ? "bg-sidebar-accent text-foreground border border-sidebar-border"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              }`}
            >
              <Building2 className="h-4 w-4" />
              Organisations
            </Link>
            <Link
              to="/app/admin/system"
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                pathname.startsWith("/app/admin/system")
                  ? "bg-sidebar-accent text-foreground border border-sidebar-border"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              }`}
            >
              <ServerCrash className="h-4 w-4" />
              System health
            </Link>
            <Link
              to="/app/admin/audit"
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                pathname.startsWith("/app/admin/audit")
                  ? "bg-sidebar-accent text-foreground border border-sidebar-border"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              }`}
            >
              <History className="h-4 w-4" />
              Platform audit
            </Link>
          </nav>

          <div className="px-3 py-3 border-t border-sidebar-border space-y-2">
            <div className="rounded-md bg-surface-2 border border-border p-3">
              <div className="flex items-center gap-2 text-xs">
                <span className="h-2 w-2 rounded-full bg-resolved pulse-dot" />
                <span className="font-medium">Platform console</span>
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground font-mono">
                Global admin · <span suppressHydrationWarning>{clock || "--:--"}</span>
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
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Platform dashboard</div>
                <div className="text-sm font-medium">{access.orgName}</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-2 rounded-md border border-resolved/40 bg-resolved/10 px-2.5 py-1 text-[11px] text-resolved">
                <Radio className="h-3 w-3 pulse-dot" />
                <span className="font-mono uppercase tracking-wider">Platform health</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="grid h-7 w-7 place-items-center rounded-full bg-accent/20 border border-accent/40 text-[10px] font-bold text-accent">
                  {me.name.split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase() || "AD"}
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
              <span className="truncate font-medium">{activeOrg?.name ?? access.orgName ?? "No organisation"}</span>
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
          {visibleNav.map((item) => {
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
