import { useState, useRef, useEffect, useMemo } from "react";
import { Bell, Loader2, Check, ChevronRight } from "lucide-react";
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
  const preview = useMemo(() => notifs.slice(0, 5), [notifs]);

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
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="ibtn"
        aria-expanded={open}
        aria-label={`Alerts${unread ? `, ${unread} unread` : ""}`}
      >
        <Bell size={16} strokeWidth={1.75} className="ic" />
        {unread > 0 && <span className="badge">{unread > 99 ? "99+" : unread}</span>}
      </button>

      {open && (
        <div className="pn absolute right-0 mt-2 w-96 max-w-[90vw] z-40 overflow-hidden shadow-2xl" style={{ background: "var(--ink-2)", borderColor: "var(--line-2)" }}>
          <div className="pn-h">
            <h3>Alerts</h3>
            {unread > 0 ? <span className="meta">{unread} unread</span> : null}
            <button
              type="button"
              onClick={() => allMut.mutate()}
              disabled={!unread || allMut.isPending}
              className="b b-sm b-gh ml-auto"
            >
              Mark all read
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {isLoading ? (
              <div className="empty flex items-center justify-center gap-2 p-8">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading…
              </div>
            ) : preview.length === 0 ? (
              <div className="empty p-8 text-center">No alerts yet.</div>
            ) : (
              <ul className="list">
                {preview.map((n) => (
                  <li key={n.id} className="px-3 py-2.5" style={n.read ? undefined : { background: "rgba(52,98,240,.06)" }}>
                    <div className="row g8">
                      <SeverityBadge severity={n.severity as Severity} />
                      {!n.read && <span className="dot d-blue" aria-label="Unread" />}
                      <span className="mono t3 ml-auto" style={{ fontSize: 11 }}>{timeAgo(n.sent_at)}</span>
                    </div>
                    <div className={`mt-1 trunc ${n.read ? "t2" : "t1 font-semibold"}`}>{n.title}</div>
                    {n.body && <div className="t3 line-clamp-2 mt-0.5" style={{ fontSize: 12 }}>{n.body}</div>}
                    <div className="row g12 mt-1.5">
                      {n.incident_id && (
                        <Link
                          to="/app/incidents/$id"
                          params={{ id: n.incident_id }}
                          onClick={() => { setOpen(false); if (!n.read) readMut.mutate(n.id); }}
                          className="lnk text-[12px]"
                        >
                          View incident
                        </Link>
                      )}
                      {!n.read && (
                        <button type="button" onClick={() => readMut.mutate(n.id)} className="t3 hover:text-tx-1 inline-flex items-center gap-1 text-[12px]">
                          <Check className="h-3 w-3" /> Mark read
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Link
            to="/app/alerts"
            onClick={() => setOpen(false)}
            className="row g4 justify-center py-2.5 t2 hover:text-tx-1 text-[12px]"
            style={{ borderTop: "1px solid var(--line-1)" }}
          >
            View all alerts <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
      )}
    </div>
  );
}
