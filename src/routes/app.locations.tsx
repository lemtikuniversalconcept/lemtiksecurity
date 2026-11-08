import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { listLocations, upsertLocation, deleteLocation } from "@/lib/orgs.functions";
import { requireSectionAccess } from "@/lib/rbac";
import { Loader2, Plus, Save, X } from "lucide-react";
import { Empty, Notice, PageHeader, Panel, Tag } from "@/components/nw";
import { LocationPicker, useMapboxToken } from "@/components/LocationPicker";

export const Route = createFileRoute("/app/locations")({
  head: () => ({ meta: [{ title: "Locations · Lemtik SOD" }] }),
  beforeLoad: async ({ context }) => {
    requireSectionAccess(context.appAccess, ["security_manager", "client_admin"]);
  },
  component: Locations,
});

type Loc = { id: string; name: string; address: string | null; coord_x: number | null; coord_y: number | null; geofence: unknown };
type Form = { id?: string; name: string; address: string; lat: string; lng: string; geofence: string };
const EMPTY: Form = { name: "", address: "", lat: "", lng: "", geofence: "" };

function toForm(l: Loc): Form {
  return {
    id: l.id,
    name: l.name,
    address: l.address ?? "",
    lat: l.coord_y != null ? String(l.coord_y) : "",
    lng: l.coord_x != null ? String(l.coord_x) : "",
    geofence: l.geofence ? JSON.stringify(l.geofence, null, 2) : "",
  };
}

function geofenceProblem(raw: string): string | null {
  if (!raw.trim()) return null;
  try {
    const g = JSON.parse(raw);
    if (!g || typeof g !== "object" || !("type" in g)) return "The geofence needs to be a GeoJSON object, e.g. a Polygon.";
    return null;
  } catch {
    return "The geofence isn't valid JSON yet.";
  }
}

function Locations() {
  const list = useServerFn(listLocations);
  const upsert = useServerFn(upsertLocation);
  const del = useServerFn(deleteLocation);
  const qc = useQueryClient();
  const { data: token } = useMapboxToken();
  const { data: locations = [], isLoading, error } = useQuery({ queryKey: ["org-locations"], queryFn: () => list() });

  const [form, setForm] = useState<Form | null>(null);
  const [deleting, setDeleting] = useState<Loc | null>(null);

  // A site drafted from the live map's context menu arrives with real coordinates and nothing else.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("lemtik_zone_draft");
      if (!raw) return;
      sessionStorage.removeItem("lemtik_zone_draft");
      const p = JSON.parse(raw) as { name?: string; coord_x?: number; coord_y?: number };
      setForm({ ...EMPTY, name: p.name ?? "", lat: p.coord_y != null ? String(p.coord_y) : "", lng: p.coord_x != null ? String(p.coord_x) : "" });
    } catch {
      sessionStorage.removeItem("lemtik_zone_draft");
    }
  }, []);

  const lat = form && form.lat.trim() !== "" ? Number(form.lat) : null;
  const lng = form && form.lng.trim() !== "" ? Number(form.lng) : null;
  const coordsBad = form != null && ((lat != null && (!Number.isFinite(lat) || Math.abs(lat) > 90)) || (lng != null && (!Number.isFinite(lng) || Math.abs(lng) > 180)) || (lat == null) !== (lng == null));
  const geoBad = form ? geofenceProblem(form.geofence) : null;

  const saveMut = useMutation({
    mutationFn: (f: Form) =>
      upsert({
        data: {
          id: f.id,
          name: f.name.trim(),
          address: f.address.trim() || undefined,
          coord_x: lng ?? undefined,
          coord_y: lat ?? undefined,
          geofence: f.geofence.trim() ? JSON.parse(f.geofence) : undefined,
        },
      }),
    onSuccess: (_r, f) => {
      qc.invalidateQueries({ queryKey: ["org-locations"] });
      toast.success(f.id ? "Location saved" : "Location added");
      setForm(null);
    },
    onError: (e: Error) => toast.error(e.message || "That didn't save."),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["org-locations"] });
      toast.success("Location deleted");
      setDeleting(null);
    },
    onError: (e: Error) => toast.error(e.message || "That didn't delete."),
  });

  const all = locations as Loc[];
  const mapped = all.filter((l) => l.coord_x != null && l.coord_y != null).length;
  const fenced = all.filter((l) => !!l.geofence).length;

  return (
    <div className="col g16">
      <PageHeader title="Locations" sub={`${all.length} site${all.length === 1 ? "" : "s"} · ${mapped} on the map · ${fenced} with a geofence`}>
        <button type="button" className="b b-pri" onClick={() => setForm({ ...EMPTY })}>
          <Plus className="h-4 w-4" /> Add location
        </button>
      </PageHeader>

      <div className={`grid gap-4 ${form ? "xl:grid-cols-[minmax(0,1fr)_440px]" : ""}`} style={{ alignItems: "start" }}>
        <Panel title="Sites" meta={`${all.length}`} bodyClassName="">
          {error ? (
            <div className="pn-b">
              <Notice tone="fail">{(error as Error).message}</Notice>
            </div>
          ) : isLoading ? (
            <Empty>
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
            </Empty>
          ) : all.length === 0 ? (
            <Empty>No locations yet. Add your first site so incidents, patrols and guests can be tied to it.</Empty>
          ) : (
            <div className="scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Address</th>
                    <th>Coordinates</th>
                    <th>Geofence</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {all.map((l) => (
                    <tr key={l.id} style={{ background: form?.id === l.id ? "var(--ink-2)" : undefined }}>
                      <td>
                        <b>{l.name}</b>
                      </td>
                      <td className="t2">{l.address ?? "—"}</td>
                      <td className="mono t2">{l.coord_x != null && l.coord_y != null ? `${Number(l.coord_y).toFixed(5)}, ${Number(l.coord_x).toFixed(5)}` : <Tag tone="warn">Not on map</Tag>}</td>
                      <td>{l.geofence ? <Tag tone="ok">Set</Tag> : <span className="t3">—</span>}</td>
                      <td>
                        <span className="row g6" style={{ justifyContent: "flex-end" }}>
                          <button type="button" className="b b-sm b-gh" onClick={() => setForm(toForm(l))}>
                            Edit
                          </button>
                          <button type="button" className="b b-sm b-gh" onClick={() => setDeleting(l)}>
                            Delete
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {form && (
          <aside className="side">
            <Panel
              title={form.id ? `Edit ${form.name || "location"}` : "Add a location"}
              actions={
                <button type="button" className="ibtn" style={{ width: 28, height: 28 }} aria-label="Close" onClick={() => setForm(null)}>
                  <X size={14} />
                </button>
              }
            >
              <form
                className="col g12"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!coordsBad && !geoBad) saveMut.mutate(form);
                }}
              >
                <label className="fl">
                  <span className="lbl">Name</span>
                  <input className="in" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Main gate" />
                </label>
                <label className="fl">
                  <span className="lbl">Address</span>
                  <input className="in" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
                </label>
                {token?.token ? (
                  <LocationPicker
                    value={lat != null && lng != null && !coordsBad ? [lng, lat] : null}
                    onChange={([x, y]) => setForm({ ...form, lng: String(x), lat: String(y) })}
                    height={220}
                  />
                ) : null}
                <div className="grid grid-cols-2 gap-3">
                  <label className="fl">
                    <span className="lbl">Latitude</span>
                    <input className="in mono" inputMode="decimal" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} placeholder="6.4281" />
                  </label>
                  <label className="fl">
                    <span className="lbl">Longitude</span>
                    <input className="in mono" inputMode="decimal" value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} placeholder="3.4219" />
                  </label>
                </div>
                {coordsBad && <Notice tone="warn">Enter both latitude and longitude as numbers, or leave both empty.</Notice>}
                <label className="fl">
                  <span className="lbl">Geofence (GeoJSON, optional)</span>
                  <textarea
                    className="in mono"
                    rows={6}
                    value={form.geofence}
                    onChange={(e) => setForm({ ...form, geofence: e.target.value })}
                    placeholder='{ "type": "Polygon", "coordinates": [[[3.42,6.45],[3.43,6.45],[3.43,6.46],[3.42,6.46],[3.42,6.45]]] }'
                    style={{ height: "auto", paddingTop: 8, fontSize: 11.5 }}
                  />
                </label>
                {geoBad && <Notice tone="warn">{geoBad}</Notice>}
                <div className="row g8" style={{ justifyContent: "flex-end" }}>
                  <button type="button" className="b b-gh" onClick={() => setForm(null)}>
                    Cancel
                  </button>
                  <button type="submit" className="b b-pri" disabled={saveMut.isPending || !form.name.trim() || coordsBad || !!geoBad}>
                    {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : form.id ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                    {form.id ? "Save" : "Add location"}
                  </button>
                </div>
              </form>
            </Panel>
          </aside>
        )}
      </div>

      {deleting && (
        <div className="fixed inset-0 z-50 grid place-items-center px-4" style={{ background: "rgba(5,7,10,.72)" }} role="dialog" aria-modal="true" aria-label={`Delete ${deleting.name}`}>
          <div className="pn w-full" style={{ maxWidth: 440, borderColor: "var(--line-2)" }}>
            <div className="pn-h">
              <h3 style={{ fontSize: 15 }}>Delete {deleting.name}?</h3>
            </div>
            <div className="pn-b col g12">
              <p className="t2" style={{ margin: 0 }}>
                The site is removed from this organisation. This can't be undone.
              </p>
              <div className="row g8" style={{ justifyContent: "flex-end" }}>
                <button type="button" className="b b-gh" onClick={() => setDeleting(null)}>
                  Keep
                </button>
                <button type="button" className="b b-red" disabled={delMut.isPending} onClick={() => delMut.mutate(deleting.id)}>
                  {delMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
