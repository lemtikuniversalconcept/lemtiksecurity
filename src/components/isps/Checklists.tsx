import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { ClipboardCheck, Loader2, Plus, Trash2, X } from "lucide-react";
import { Notice, Panel, Status } from "@/components/nw";
import { getLevelMeasures, listOpenChecklists, listRecentChecklists, saveLevelMeasures, tickChecklistItem, type ChecklistRun } from "@/lib/isps-checklist.functions";
import { LEVEL_LABEL } from "@/lib/isps.rules";

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" }) : "—");
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const mins = (a: string, b: string | null) => (b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60_000)) : null);
const levelColour = (l: number) => (l === 3 ? "var(--s5, #F2384B)" : l === 2 ? "var(--s4, #E8590C)" : "var(--line-2, rgba(127,127,127,.35))");

// ───────────────────────────── Ticking off ─────────────────────────────

/** Open checklists for anyone on duty: tick each measure once it's in place. */
export function OpenChecklists() {
  const qc = useQueryClient();
  const listFn = useServerFn(listOpenChecklists);
  const tickFn = useServerFn(tickChecklistItem);
  const q = useQuery({ queryKey: ["isps-checklists-open"], queryFn: () => listFn(), refetchInterval: 30_000 });
  const m = useMutation({
    mutationFn: (v: { run_id: string; index: number; done: boolean }) => tickFn({ data: v }),
    onSuccess: (r) => {
      if (r?.completed) toast.success("Checklist complete");
      qc.invalidateQueries({ queryKey: ["isps-checklists-open"] });
      qc.invalidateQueries({ queryKey: ["isps-checklists-recent"] });
    },
    onError: (e) => { toast.error((e as Error).message); qc.invalidateQueries({ queryKey: ["isps-checklists-open"] }); },
  });
  const runs = q.data ?? [];
  if (!runs.length) return null;
  return (
    <div className="col g8">
      {runs.map((r) => {
        const done = r.items.filter((i) => i.done_at).length;
        return (
          <div key={r.id} className="col g8" style={{ border: `2px solid ${levelColour(r.level)}`, borderRadius: 10, padding: "12px 14px" }}>
            <div className="row g8 wrap" style={{ alignItems: "center" }}>
              <ClipboardCheck size={16} />
              <b className="f1" style={{ fontSize: 14 }}>{LEVEL_LABEL[r.level]} checklist · {r.facility} · {r.post_name}</b>
              <span className="t3" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{done} of {r.items.length} · since {time(r.started_at)}</span>
            </div>
            <div className="col g4">
              {r.items.map((it, i) => (
                <label key={i} className="row g8" style={{ alignItems: "flex-start", fontSize: 13.5, cursor: "pointer", padding: "4px 0" }}>
                  <input type="checkbox" checked={!!it.done_at} disabled={m.isPending} onChange={(e) => m.mutate({ run_id: r.id, index: i, done: e.target.checked })} style={{ width: 20, height: 20, marginTop: 1, flex: "none" }} />
                  <span className="f1">{it.text}{it.done_at && <span className="t3" style={{ fontSize: 12 }}> · {time(it.done_at)} by {it.done_by_name ?? "—"}</span>}</span>
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ───────────────────────────── Progress for managers ─────────────────────────────

/** The latest level change's checklists for one facility: each post, when it started and finished. */
export function FacilityChecklistStatus({ facilityId, runs }: { facilityId: string; runs: ChecklistRun[] }) {
  const mine = runs.filter((r) => r.facility_id === facilityId);
  if (!mine.length) return null;
  const latest = mine[0].started_at;
  const current = mine.filter((r) => r.started_at === latest);
  const open = current.filter((r) => !r.completed_at && !r.superseded_at).length;
  return (
    <div className="col g4" style={{ fontSize: 12.5 }}>
      <span className="t2"><b>{LEVEL_LABEL[current[0].level]} checklist</b> sent {when(latest)}{open ? ` · ${open} post${open === 1 ? "" : "s"} not finished` : " · all posts finished"}</span>
      <div className="row g6 wrap">
        {current.map((r) => {
          const done = r.items.filter((i) => i.done_at).length;
          const took = mins(r.started_at, r.completed_at);
          return (
            <Status key={r.id} tone={r.completed_at ? "ok" : r.superseded_at ? "off" : done ? "warn" : "fail"}>
              {r.post_name}: {r.completed_at ? `done ${time(r.completed_at)} (${took} min)` : r.superseded_at ? "set aside" : `${done} of ${r.items.length}${r.first_tick_at ? ` · started ${time(r.first_tick_at)}` : " · not started"}`}
            </Status>
          );
        })}
      </div>
    </div>
  );
}

export function useRecentChecklists() {
  const fn = useServerFn(listRecentChecklists);
  return useQuery({ queryKey: ["isps-checklists-recent"], queryFn: () => fn(), refetchInterval: 60_000 });
}

// ───────────────────────────── Setting up ─────────────────────────────

type Measure = { text: string; post_id: string | null };
const LEVELS = ["1", "2", "3"] as const;

/** Managers: the facility's guard posts and the measures for each level, from its security plan. */
export function LevelMeasuresEditor({ facilityId, facilityName, onDone }: { facilityId: string; facilityName: string; onDone: () => void }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getLevelMeasures);
  const saveFn = useServerFn(saveLevelMeasures);
  const q = useQuery({ queryKey: ["isps-measures", facilityId], queryFn: () => getFn({ data: { facility_id: facilityId } }) });
  const [posts, setPosts] = useState<{ id: string; name: string }[] | null>(null);
  const [measures, setMeasures] = useState<Record<"1" | "2" | "3", Measure[]> | null>(null);
  const [newPost, setNewPost] = useState("");
  const p = posts ?? q.data?.posts ?? [];
  const ms = measures ?? q.data?.measures ?? { "1": [], "2": [], "3": [] };
  const setM = (l: "1" | "2" | "3", list: Measure[]) => setMeasures({ ...ms, [l]: list });
  const save = useMutation({
    mutationFn: () => saveFn({ data: { facility_id: facilityId, posts: p, measures: { "1": ms["1"].filter((x) => x.text.trim().length >= 2), "2": ms["2"].filter((x) => x.text.trim().length >= 2), "3": ms["3"].filter((x) => x.text.trim().length >= 2) } } }),
    onSuccess: () => { toast.success("Saved. The next level change sends these checklists."); qc.invalidateQueries({ queryKey: ["isps-measures", facilityId] }); onDone(); },
    onError: (e) => toast.error((e as Error).message),
  });
  if (q.isLoading) return <Panel><span className="row g8 t3"><Loader2 size={14} className="animate-spin" /> Loading…</span></Panel>;
  if (q.error) return <Panel><Notice tone="fail">{(q.error as Error).message}</Notice></Panel>;
  const addPost = () => {
    const name = newPost.trim().slice(0, 80);
    if (!name) return;
    setPosts([...p, { id: crypto.randomUUID().slice(0, 8), name }]);
    setNewPost("");
  };
  return (
    <Panel title={`Level measures · ${facilityName}`} actions={<button type="button" className="b b-sm b-gh" onClick={onDone} aria-label="Close"><X size={14} /></button>}>
      <div className="col g16" style={{ fontSize: 13 }}>
        <p className="t3" style={{ margin: 0, fontSize: 12.5 }}>Copy the measures from the facility security plan. When the level changes, each guard post gets a checklist of the measures for that level (the ones for every post, plus its own), and you see when each post has done them.</p>
        <section className="col g6">
          <b className="t2" style={{ fontSize: 12 }}>Guard posts</b>
          <div className="row g6 wrap">
            {p.map((x) => (
              <span key={x.id} className="row g4" style={{ alignItems: "center", padding: "3px 8px", borderRadius: 999, background: "var(--bg-2, rgba(127,127,127,.12))" }}>
                <input className="in" style={{ border: "none", background: "transparent", padding: 0, width: Math.max(60, x.name.length * 8) }} value={x.name} onChange={(e) => setPosts(p.map((y) => (y.id === x.id ? { ...y, name: e.target.value.slice(0, 80) } : y)))} aria-label="Post name" />
                <button type="button" className="b b-sm b-gh" style={{ padding: 2 }} aria-label={`Remove ${x.name}`} onClick={() => { setPosts(p.filter((y) => y.id !== x.id)); setMeasures(Object.fromEntries(LEVELS.map((l) => [l, ms[l].map((m) => (m.post_id === x.id ? { ...m, post_id: null } : m))])) as any); }}><X size={12} /></button>
              </span>
            ))}
            <form className="row g4" onSubmit={(e) => { e.preventDefault(); addPost(); }}>
              <input className="in" style={{ width: 160 }} placeholder="e.g. Main gate" value={newPost} onChange={(e) => setNewPost(e.target.value)} maxLength={80} />
              <button type="submit" className="b b-sm b-sec" disabled={!newPost.trim()}><Plus size={12} /> Add post</button>
            </form>
          </div>
          {!p.length && <span className="t3" style={{ fontSize: 12 }}>No posts: the facility gets one checklist.</span>}
        </section>
        <div className="grid g12" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          {LEVELS.map((l) => (
            <section key={l} className="col g6" style={{ borderTop: `3px solid ${levelColour(Number(l))}`, paddingTop: 8 }}>
              <b style={{ fontSize: 12.5 }}>{LEVEL_LABEL[Number(l)]}</b>
              {ms[l].map((m, i) => (
                <div key={i} className="col g4">
                  <div className="row g4">
                    <input className="in f1" value={m.text} maxLength={300} placeholder="e.g. Search every bag at the gate" onChange={(e) => setM(l, ms[l].map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
                    <button type="button" className="b b-sm b-gh" aria-label="Remove measure" onClick={() => setM(l, ms[l].filter((_, j) => j !== i))}><Trash2 size={12} /></button>
                  </div>
                  {p.length > 0 && (
                    <select className="in" style={{ fontSize: 12 }} value={m.post_id ?? ""} onChange={(e) => setM(l, ms[l].map((x, j) => (j === i ? { ...x, post_id: e.target.value || null } : x)))} aria-label="Which post">
                      <option value="">Every post</option>
                      {p.map((x) => <option key={x.id} value={x.id}>{x.name} only</option>)}
                    </select>
                  )}
                </div>
              ))}
              <button type="button" className="b b-sm b-gh" style={{ alignSelf: "flex-start" }} disabled={ms[l].length >= 40} onClick={() => setM(l, [...ms[l], { text: "", post_id: null }])}><Plus size={12} /> Add a measure</button>
            </section>
          ))}
        </div>
        <div className="row g8">
          <button type="button" className="b b-pri" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending && <Loader2 size={14} className="animate-spin" />} Save</button>
          <button type="button" className="b b-gh" onClick={onDone}>Cancel</button>
        </div>
      </div>
    </Panel>
  );
}
