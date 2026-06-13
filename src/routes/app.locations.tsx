import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listLocations, upsertLocation, deleteLocation } from "@/lib/orgs.functions";
import { Loader2, Plus, X, MapPin, Save } from "lucide-react";

export const Route = createFileRoute("/app/locations")({
  head: () => ({ meta: [{ title: "Locations · Lemtik SOD" }] }),
  component: Locations,
});

type Loc = {
  id: string; name: string; address: string | null;
  coord_x: number | null; coord_y: number | null;
  geofence: unknown;
};

function Locations() {
  const list = useServerFn(listLocations);
  const upsert = useServerFn(upsertLocation);
  const del = useServerFn(deleteLocation);
  const qc = useQueryClient();
  const { data: locations = [], isLoading } = useQuery({ queryKey: ["org-locations"], queryFn: () => list() });

  const [draft, setDraft] = useState({ name: "", address: "", coord_x: "", coord_y: "", geofence: "" });
  const [editing, setEditing] = useState<Loc | null>(null);

  const saveMut = useMutation({
    mutationFn: () => {
      const d = editing ?? draft;
      let geofence: unknown = undefined;
      const raw = editing ? JSON.stringify(editing.geofence ?? "") : draft.geofence;
      const geoStr = typeof raw === "string" ? raw : "";
      if (geoStr && geoStr !== '""') {
        try { geofence = JSON.parse(geoStr); } catch { throw new Error("Geofence must be valid JSON (GeoJSON polygon)."); }
      }
      return upsert({ data: {
        id: editing?.id,
        name: d.name,
        address: ("address" in d ? d.address : "") || undefined,
        coord_x: editing ? (editing.coord_x ?? undefined) : (draft.coord_x ? Number(draft.coord_x) : undefined),
        coord_y: editing ? (editing.coord_y ?? undefined) : (draft.coord_y ? Number(draft.coord_y) : undefined),
        geofence,
      }});
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["org-locations"] });
      setDraft({ name: "", address: "", coord_x: "", coord_y: "", geofence: "" });
      setEditing(null);
    },
  });

  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["org-locations"] }),
  });

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Sites & posts</div>
        <h1 className="mt-1 text-2xl font-semibold">Locations</h1>
        <p className="text-sm text-muted-foreground">Physical sites belonging to this organisation. Draw geofences as GeoJSON polygons.</p>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        {isLoading ? (
          <div className="p-10 text-center text-sm text-muted-foreground"><Loader2 className="inline h-4 w-4 animate-spin mr-2" />Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Name</th>
                <th className="text-left px-4 py-3 font-medium">Address</th>
                <th className="text-left px-4 py-3 font-medium">Coords</th>
                <th className="text-left px-4 py-3 font-medium">Geofence</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(locations as Loc[]).map((l) => (
                <tr key={l.id} className="hover:bg-surface/60">
                  <td className="px-4 py-3 font-medium">
                    <div className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-primary" />{l.name}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{l.address ?? "—"}</td>
                  <td className="px-4 py-3 text-xs font-mono">{l.coord_x ?? "—"}, {l.coord_y ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{l.geofence ? "set" : "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setEditing(l)} className="text-xs text-primary hover:underline mr-3">Edit</button>
                    <button onClick={() => delMut.mutate(l.id)} className="text-muted-foreground hover:text-critical">
                      <X className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {locations.length === 0 && (
                <tr><td colSpan={5} className="p-6 text-center text-sm text-muted-foreground">No locations yet.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Add / Edit form */}
      <div className="rounded-lg border border-border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold">{editing ? `Edit "${editing.name}"` : "Add a location"}</h2>
        {editing ? (
          <div className="grid grid-cols-2 gap-3">
            <Input label="Name" value={editing.name} onChange={(v) => setEditing({ ...editing, name: v })} />
            <Input label="Address" value={editing.address ?? ""} onChange={(v) => setEditing({ ...editing, address: v })} />
            <Input label="Latitude" value={String(editing.coord_y ?? "")} onChange={(v) => setEditing({ ...editing, coord_y: v ? Number(v) : null })} />
            <Input label="Longitude" value={String(editing.coord_x ?? "")} onChange={(v) => setEditing({ ...editing, coord_x: v ? Number(v) : null })} />
            <div className="col-span-2 space-y-1.5">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Geofence (GeoJSON polygon)</label>
              <textarea
                value={editing.geofence ? JSON.stringify(editing.geofence, null, 2) : ""}
                onChange={(e) => { try { setEditing({ ...editing, geofence: e.target.value ? JSON.parse(e.target.value) : null }); } catch { /* keep raw */ } }}
                rows={6}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-xs font-mono"
                placeholder='{ "type":"Polygon","coordinates":[[[3.42,6.45],[3.43,6.45],[3.43,6.46],[3.42,6.46],[3.42,6.45]]] }'
              />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Input label="Name" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />
            <Input label="Address" value={draft.address} onChange={(v) => setDraft({ ...draft, address: v })} />
            <Input label="Latitude" value={draft.coord_y} onChange={(v) => setDraft({ ...draft, coord_y: v })} />
            <Input label="Longitude" value={draft.coord_x} onChange={(v) => setDraft({ ...draft, coord_x: v })} />
            <div className="col-span-2 space-y-1.5">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Geofence (GeoJSON polygon)</label>
              <textarea value={draft.geofence} onChange={(e) => setDraft({ ...draft, geofence: e.target.value })} rows={6}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-xs font-mono"
                placeholder='{ "type":"Polygon","coordinates":[[[3.42,6.45],[3.43,6.45],[3.43,6.46],[3.42,6.46],[3.42,6.45]]] }' />
            </div>
          </div>
        )}
        {saveMut.error && <div className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-critical">{(saveMut.error as Error).message}</div>}
        <div className="flex items-center gap-2">
          <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || (editing ? !editing.name : !draft.name)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {saveMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : editing ? <Save className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {editing ? "Save changes" : "Add location"}
          </button>
          {editing && (
            <button onClick={() => setEditing(null)} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
          )}
        </div>
      </div>
    </div>
  );
}

function Input({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
    </div>
  );
}
