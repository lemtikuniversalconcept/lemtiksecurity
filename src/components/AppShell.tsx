import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import type { Feature } from "@/lib/features";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  Boxes,
  Building2,
  Cctv,
  ChartColumn,
  ChevronDown,
  Clock4,
  Cpu,
  FileText,
  History,
  LayoutDashboard,
  LogOut,
  Map,
  MapPin,
  Menu,
  Plus,
  Radar,
  ReceiptText,
  Navigation,
  Route,
  Search,
  Server,
  Package,
  Share2,
  ShieldCheck,
  Siren,
  Sparkles,
  Users,
  X,
  Ship,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { listMyOrgs, switchActiveOrg, getActiveOrg } from "@/lib/orgs.functions";
import { listMyNotifications } from "@/lib/alerts.functions";
import { NotificationBell } from "@/components/NotificationBell";
import { PriorityBar, useOpenIncidentSummary } from "@/components/PriorityBar";
import { CommandPalette, useCommandPaletteShortcut, type AppPath, type PaletteGroup } from "@/components/CommandPalette";
import { Avatar, LemtikMark, initialsOf } from "@/components/nw";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AppAccess, OrgKind, SpecRole } from "@/lib/rbac";
import type { LucideIcon } from "lucide-react";

type NavItem = { to: AppPath; label: string; icon: LucideIcon; exact?: boolean; allowed: SpecRole[]; count?: "incidents" | "alerts"; kinds?: OrgKind[]; labelFor?: Partial<Record<OrgKind, string>>; feature?: Feature };
// Which kinds of organisation see an item (none listed = everyone).
const ON_LAND_AND_PORT: OrgKind[] = ["land", "port_facility"];
const OPERATORS: OrgKind[] = ["land", "maritime_operator", "port_facility"];
const MARITIME_ISPS: OrgKind[] = ["maritime_operator", "port_facility", "authority"];
type NavGroup = { label: string; items: NavItem[] };

const ALL: SpecRole[] = ["security_manager", "operator", "client_admin"];
const OPS: SpecRole[] = ["security_manager", "operator"];
const ADMINS: SpecRole[] = ["security_manager", "client_admin"];

const CLIENT_NAV: NavGroup[] = [
  {
    label: "Operate",
    items: [
      { to: "/app", label: "Overview", icon: LayoutDashboard, exact: true, allowed: ALL },
      { to: "/app/fleet", label: "Fleet overview", icon: Ship, allowed: ALL, kinds: ["maritime_operator", "port_facility"], feature: "movement" },
      { to: "/app/map", label: "Live map", icon: Map, allowed: ALL },
      { to: "/app/incidents", label: "Incidents", icon: Siren, allowed: ALL, count: "incidents" },
      { to: "/app/patrols", label: "Patrols", icon: Route, allowed: ALL, kinds: ON_LAND_AND_PORT },
      { to: "/app/movement", label: "Protected movement", icon: Navigation, allowed: ALL, kinds: OPERATORS, labelFor: { maritime_operator: "Fleet and voyages" }, feature: "movement" },
      { to: "/app/cargo", label: "Cargo custody", icon: Package, allowed: ALL, kinds: OPERATORS, feature: "cargo" },
      { to: "/app/isps", label: "ISPS Watch", icon: ShieldCheck, allowed: ALL, kinds: MARITIME_ISPS, labelFor: { authority: "ISPS compliance" }, feature: "isps" },
      { to: "/app/links", label: "Shared access", icon: Share2, allowed: ALL, labelFor: { authority: "Members and shared access", responder: "Shared with us" }, feature: "links" },
      { to: "/app/alerts", label: "Alerts", icon: Bell, allowed: OPS, count: "alerts" },
    ],
  },
  {
    label: "Sense",
    items: [
      { to: "/app/intelligence", label: "Intelligence", icon: Radar, allowed: ALL },
      { to: "/app/sensors", label: "Cameras & sensors", icon: Cctv, allowed: OPS, kinds: OPERATORS },
      { to: "/app/devices", label: "Devices", icon: Cpu, allowed: ["security_manager"], kinds: OPERATORS },
    ],
  },
  {
    label: "Resources",
    items: [
      { to: "/app/inventory", label: "Inventory", icon: Boxes, allowed: ALL, kinds: ON_LAND_AND_PORT },
      { to: "/app/users", label: "Team", icon: Users, allowed: ADMINS },
    ],
  },
  {
    label: "Records",
    items: [
      { to: "/app/reports", label: "Analytics", icon: ChartColumn, allowed: ALL },
      { to: "/app/report-centre", label: "Report centre", icon: FileText, allowed: ALL },
      { to: "/app/audit", label: "Audit log", icon: History, allowed: ADMINS },
    ],
  },
  {
    label: "Configure",
    items: [
      { to: "/app/org", label: "Organisation", icon: Building2, allowed: ADMINS },
      { to: "/app/locations", label: "Locations", icon: MapPin, allowed: ADMINS, kinds: OPERATORS },
    ],
  },
];

const ADMIN_NAV: NavGroup[] = [
  {
    label: "Platform",
    items: [
      { to: "/app", label: "Platform overview", icon: LayoutDashboard, exact: true, allowed: ["lemtik_admin"] },
      { to: "/app/admin/organisations", label: "Organisations", icon: Building2, allowed: ["lemtik_admin"] },
      { to: "/app/admin/billing", label: "Billing", icon: ReceiptText, allowed: ["lemtik_admin"] },
      { to: "/app/admin/system", label: "System health", icon: Server, allowed: ["lemtik_admin"] },
      { to: "/app/admin/audit", label: "Platform audit", icon: History, allowed: ["lemtik_admin"] },
    ],
  },
];

function useLiveFeedStatus(channelKey: string) {
  const [status, setStatus] = useState<"connecting" | "live" | "down">("connecting");
  useEffect(() => {
    const channel = supabase.channel(`shell-status:${channelKey}`).subscribe((s) => {
      setStatus(s === "SUBSCRIBED" ? "live" : s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED" ? "down" : "connecting");
    });
    const onOffline = () => setStatus("down");
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("offline", onOffline);
      supabase.removeChannel(channel);
    };
  }, [channelKey]);
  return status;
}

function LiveFeed({ channelKey }: { channelKey: string }) {
  const status = useLiveFeedStatus(channelKey);
  const label = status === "live" ? "Live feed connected" : status === "down" ? "Live feed offline" : "Connecting live feed…";
  return (
    <div className="live" role="status">
      <span
        className={`pulse${status === "down" ? " red" : ""}`}
        style={status === "connecting" ? { background: "var(--warn)", boxShadow: "0 0 0 3px rgba(247,208,70,.18)" } : undefined}
      />
      <span>{label}</span>
    </div>
  );
}

function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const time = now ? now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--:--:--";
  const zone = now ? new Intl.DateTimeFormat("en-GB", { timeZoneName: "short" }).formatToParts(now).find((p) => p.type === "timeZoneName")?.value : "";
  const day = now ? now.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "";
  return (
    <div className="clock max-[640px]:hidden" aria-label="Local time">
      <Clock4 size={14} strokeWidth={1.75} className="ic" />
      <span suppressHydrationWarning>
        {time} {zone}
      </span>
      <span className="t3" suppressHydrationWarning>
        {day}
      </span>
    </div>
  );
}

export function AppShell({ access }: { access: AppAccess }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isAdmin = access.specRole === "lemtik_admin";
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  useCommandPaletteShortcut(setPaletteOpen);

  useEffect(() => setNavOpen(false), [pathname]);

  // One-screen pages size themselves against the sticky header, which grows when the priority bar shows.
  const headerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const root = document.documentElement;
    const ro = new ResizeObserver(() => root.style.setProperty("--shell-top", `${el.offsetHeight}px`));
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--shell-top");
    };
  }, []);

  const listMine = useServerFn(listMyOrgs);
  const getOrg = useServerFn(getActiveOrg);
  const switchOrg = useServerFn(switchActiveOrg);
  const loadNotifications = useServerFn(listMyNotifications);

  const { data: orgs = [] } = useQuery({ queryKey: ["my-orgs"], queryFn: () => listMine(), enabled: !isAdmin });
  const { data: activeOrg } = useQuery({ queryKey: ["active-org"], queryFn: () => getOrg(), enabled: !isAdmin });
  const { data: notifications = [] } = useQuery({
    queryKey: ["my-notifications"],
    queryFn: () => loadNotifications(),
    enabled: !isAdmin,
    refetchInterval: 30_000,
  });
  const { data: incidentSummary } = useOpenIncidentSummary(!isAdmin);

  const switchMut = useMutation({
    mutationFn: (id: string) => switchOrg({ data: { organisation_id: id } }),
    onSuccess: () => {
      qc.invalidateQueries();
      navigate({ to: "/app" });
    },
  });

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login", search: { redirect: undefined }, replace: true });
  };

  const name = access.displayName || access.email || "Signed in";
  const orgName = activeOrg?.name ?? access.orgName ?? "No organisation";
  const unread = notifications.filter((n) => !n.read).length;
  const openIncidents = incidentSummary?.openCount ?? 0;
  const hasCritical = Number(incidentSummary?.top?.severity ?? 0) >= 5;

  const groups = useMemo(
    () =>
      (isAdmin ? ADMIN_NAV : CLIENT_NAV)
        .map((g) => ({
          ...g,
          items: g.items
            .filter((i) => i.allowed.includes(access.specRole) && (isAdmin || ((!i.kinds || i.kinds.includes(access.orgKind)) && (!i.feature || access.features.includes(i.feature)))))
            .map((i) => ({ ...i, label: (!isAdmin && i.labelFor?.[access.orgKind]) || i.label })),
        }))
        .filter((g) => g.items.length > 0),
    [isAdmin, access.specRole, access.orgKind],
  );
  const paletteGroups: PaletteGroup[] = groups.map((g) => ({ label: g.label, items: g.items.map(({ to, label, icon }) => ({ to, label, icon })) }));

  const countFor = (kind: NavItem["count"]) => {
    if (kind === "incidents" && openIncidents > 0) return <span className={`cnt${hasCritical ? " hot" : ""}`}>{openIncidents}</span>;
    if (kind === "alerts" && unread > 0) return <span className="cnt">{unread > 99 ? "99+" : unread}</span>;
    return null;
  };

  const hideOnSmall = navOpen ? "" : " max-[784px]:hidden";

  return (
    <div className="app">
      <aside className="side" aria-label="Main navigation">
        <div className="brand">
          <LemtikMark />
          <div>
            <b>LEMTIK</b>
            <small>{isAdmin ? "Platform admin" : "Command centre"}</small>
          </div>
          <button
            type="button"
            className="ibtn ml-auto min-[785px]:hidden"
            aria-label={navOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={navOpen}
            onClick={() => setNavOpen((o) => !o)}
          >
            {navOpen ? <X size={16} strokeWidth={1.75} /> : <Menu size={16} strokeWidth={1.75} />}
          </button>
        </div>

        {!isAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={`orgsw${hideOnSmall}`} aria-label="Switch organisation">
                <span className="lg">{initialsOf(orgName)}</span>
                <span className="f1">
                  <span className="trunc" style={{ display: "block", fontSize: 13, fontWeight: 600 }}>
                    {orgName}
                  </span>
                  <span style={{ display: "block", fontSize: 11, color: "var(--tx-3)" }}>{access.roleLabel}</span>
                </span>
                <ChevronDown size={14} strokeWidth={1.75} className="ic t3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
              <DropdownMenuLabel className="eyebrow">Your organisations</DropdownMenuLabel>
              {orgs.map((o) => (
                <DropdownMenuItem key={o.id} onSelect={() => o.id !== activeOrg?.id && switchMut.mutate(o.id)} className="justify-between gap-3">
                  <span className="trunc">{o.name}</span>
                  {o.id === activeOrg?.id ? <span className="tg tg-blue">Current</span> : <span className="t3 text-[11px]">{o.role.replace("_", " ")}</span>}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/onboarding" className="lnk">
                  <Plus size={14} strokeWidth={1.75} />
                  Create or join another
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <nav className={`nav${hideOnSmall}`}>
          {groups.map((group) => (
            <div key={group.label} className="contents">
              <div className="grp">{group.label}</div>
              {group.items.map((item) => {
                const active = item.exact ? pathname === item.to || pathname === `${item.to}/` : pathname === item.to || pathname.startsWith(`${item.to}/`);
                const Icon = item.icon;
                return (
                  <Link key={item.to} to={item.to} className={active ? "on" : undefined} aria-current={active ? "page" : undefined}>
                    <Icon size={16} strokeWidth={1.75} className="ic" />
                    <span>{item.label}</span>
                    {countFor(item.count)}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className={`sidefoot${hideOnSmall}`}>
          <LiveFeed channelKey={isAdmin ? "platform" : access.orgId} />
          <div className="t3 trunc" style={{ fontSize: 11.5 }}>
            {isAdmin ? "No access to client incident data" : orgName}
          </div>
        </div>
      </aside>

      <div className="main">
        <div ref={headerRef} className="sticky top-0 z-20">
          <header className="top">
            <button type="button" className="cmdk" onClick={() => setPaletteOpen(true)} aria-label={isAdmin ? "Search platform pages" : "Search pages or ask Lemtik"}>
              {isAdmin ? <Search size={15} strokeWidth={1.75} className="ic" /> : <Sparkles size={15} strokeWidth={1.75} className="ic" />}
              <span className="trunc">{isAdmin ? "Search platform pages" : "Search, or ask Lemtik — “patrols with late check-ins”"}</span>
              <span className="kbd">⌘K</span>
            </button>
            <div className="flex-auto" />
            <Clock />
            {!isAdmin && <NotificationBell />}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="me" aria-label="Account menu">
                  <Avatar name={name} size="lg" own />
                  <span className="max-[640px]:hidden">
                    <b>{name}</b>
                    <small>{access.roleLabel}</small>
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <span className="block trunc">{name}</span>
                  {access.email && access.email !== name ? <span className="block t3 text-[11px] font-normal trunc">{access.email}</span> : null}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={signOut}>
                  <LogOut size={14} strokeWidth={1.75} />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </header>
          {!isAdmin && <PriorityBar orgId={access.orgId} />}
        </div>

        <main className="page">
          <Outlet />
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        groups={paletteGroups}
        canAsk={!isAdmin && groups.some((g) => g.items.some((i) => i.to === "/app"))}
        placeholder={isAdmin ? "Search platform pages…" : "Search pages, or ask Lemtik…"}
      />
    </div>
  );
}
