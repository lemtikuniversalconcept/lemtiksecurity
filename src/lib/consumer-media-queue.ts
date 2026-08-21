const DB_NAME = "lemtik-consumer-media-queue";
const STORE_NAME = "pending-uploads";

export type QueuedMedia = {
  id: string;
  reportId: string;
  token: string;
  mediaType: string;
  chunkIndex: number | null;
  blob: Blob;
  filename: string;
  queuedAt: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function queueMediaUpload(item: Omit<QueuedMedia, "id" | "queuedAt">): Promise<void> {
  const db = await openDb();
  const record: QueuedMedia = { ...item, id: crypto.randomUUID(), queuedAt: Date.now() };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listQueuedMedia(): Promise<QueuedMedia[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result as QueuedMedia[]);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return [];
  }
}

async function removeQueuedMedia(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function uploadMediaChunk(params: {
  reportId: string;
  token: string;
  mediaType: string;
  chunkIndex: number | null;
  blob: Blob;
  filename: string;
}): Promise<{ media_id: string; storage_path: string }> {
  const base = (import.meta.env.VITE_RELATIONSHIP_API_PUBLIC_URL as string | undefined)?.replace(/\/+$/, "");
  if (!base) throw new Error("Media upload endpoint is not configured");
  const form = new FormData();
  form.append("file", params.blob, params.filename);
  form.append("media_type", params.mediaType);
  if (params.chunkIndex != null) form.append("chunk_index", String(params.chunkIndex));
  const response = await fetch(`${base}/consumer/report/${params.reportId}/media`, {
    method: "POST",
    headers: { "X-Consumer-Token": params.token },
    body: form,
  });
  if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
  return response.json();
}

// Three attempts with exponential backoff (1s, 2s, 4s); on final failure the
// blob is parked in IndexedDB rather than dropped, so a lost connection during
// an emergency report never silently loses evidence.
export async function uploadWithRetry(params: {
  reportId: string;
  token: string;
  mediaType: string;
  chunkIndex: number | null;
  blob: Blob;
  filename: string;
}): Promise<{ ok: true; mediaId: string } | { ok: false; queued: boolean }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await uploadMediaChunk(params);
      return { ok: true, mediaId: result.media_id };
    } catch {
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
  try {
    await queueMediaUpload(params);
    return { ok: false, queued: true };
  } catch {
    return { ok: false, queued: false };
  }
}

export async function drainMediaQueue(): Promise<number> {
  const items = await listQueuedMedia();
  let drained = 0;
  for (const item of items) {
    try {
      await uploadMediaChunk(item);
      await removeQueuedMedia(item.id);
      drained++;
    } catch {
      break;
    }
  }
  return drained;
}
