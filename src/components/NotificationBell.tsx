import { useState, useRef, useEffect } from "react";
import { Bell, Loader2, Check } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { listMyNotifications, markNotificationRead, markAllNotificationsRead } from "@/lib/alerts.functions";
import { useRealtimeInvalidate } from "@/lib/useRealtime";
import { SeverityBadge } from "@/components/SeverityBadge";
import { type Severity } from "@/lib/mockData";

function timeAgo(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const list = useServerFn(listMyNotifications);
  const markRead = useServerFn(markNotificationRead);
  const markAll = useServerFn(markAllNotificationsRead);

  useRealtimeInvalidate("alerts", [["my-notifications"], ["alerts"]]);

  const { data: notifs = [], isLoading } = useQuery({
    queryKey: ["my-notifications"],
    queryFn: () => list(),
    refetchInterval: 30_000,
  });

  const unread = notifs.filter((n) => !n.read).length;

  const readMut = useMutation({
    mutationFn: (id: string) => markRead({ data: { alert_id: id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-notifications"] }),
  });
  const allMut = useMutation({
    mutationFn: () => markAll(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-notifications"] }),
  });

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-md border border-border bg-surface p-1.5 hover:bg-surface-2"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 grid place-items-center rounded-full bg-critical text-[9px] font-bold text-critical-foreground">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-96 max-w-[90vw] z-40 rounded-lg border border-border bg-card shadow-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
            <div className="text-sm font-medium">Notifications</div>
            <button
              onClick={() => allMut.mutate()}
              disabled={!unread || allMut.isPending}
              className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              Mark all read
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {isLoading ? (
              <div className="p-8 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading…
              </div>
            ) : notifs.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">No notifications yet.</div>
            ) : (
              <ul className="divide-y divide-border">
                {notifs.map((n) => (
                  <li key={n.id} className={`px-4 py-3 ${n.read ? "" : "bg-primary/5"}`}>
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <SeverityBadge severity={n.severity as Severity} />
                          <span className="text-[10px] text-muted-foreground font-mono">{timeAgo(n.sent_at)}</span>
                        </div>
                        <div className={`text-xs ${n.read ? "text-muted-foreground" : "font-medium"} truncate`}>{n.title}</div>
                        {n.body && <div className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{n.body}</div>}
                        <div className="mt-1 flex items-center gap-3">
                          {n.incident_id && (
                            <Link
                              to="/app/incidents/$id"
                              params={{ id: n.incident_id }}
                              onClick={() => { setOpen(false); if (!n.read) readMut.mutate(n.id); }}
                              className="text-[10px] text-primary hover:underline"
                            >
                              View incident
                            </Link>
                          )}
                          {!n.read && (
                            <button
                              onClick={() => readMut.mutate(n.id)}
                              className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                            >
                              <Check className="h-2.5 w-2.5" /> Mark read
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Link
            to="/app/alerts"
            onClick={() => setOpen(false)}
            className="block text-center text-[11px] py-2 border-t border-border text-muted-foreground hover:text-foreground hover:bg-surface-2"
          >
            View all alerts & settings →
          </Link>
        </div>
      )}
    </div>
  );
}
