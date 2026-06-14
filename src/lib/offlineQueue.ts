// Tiny localStorage-backed queue for incident submissions made offline.
// Auto-flushes when the browser regains connectivity.
import type { IncidentSubmitPayload } from "@/components/IncidentReportForm";

const KEY = "lemtik.offline.incidents.v1";

export type QueuedIncident = { id: string; queuedAt: number; payload: IncidentSubmitPayload };

function read(): QueuedIncident[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}
function write(items: QueuedIncident[]) {
  localStorage.setItem(KEY, JSON.stringify(items));
}

export function enqueue(payload: IncidentSubmitPayload): QueuedIncident {
  const item: QueuedIncident = { id: crypto.randomUUID(), queuedAt: Date.now(), payload };
  const items = read();
  items.push(item);
  write(items);
  return item;
}

export function list(): QueuedIncident[] { return read(); }

export function remove(id: string) {
  write(read().filter((i) => i.id !== id));
}

export function subscribe(cb: () => void): () => void {
  const handler = (e: StorageEvent) => { if (e.key === KEY) cb(); };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

export async function flush(send: (p: IncidentSubmitPayload) => Promise<unknown>): Promise<number> {
  const items = read();
  let ok = 0;
  for (const it of items) {
    try { await send(it.payload); remove(it.id); ok++; }
    catch { /* leave in queue */ break; }
  }
  return ok;
}
