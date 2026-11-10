import { createHash } from "node:crypto";

export const EVIDENCE_BUCKET = "incident-evidence";

export function sha256Hex(data: Uint8Array | string) {
  return createHash("sha256").update(data).digest("hex");
}

/** Downloads a stored evidence file with the caller's own permissions and fingerprints it. */
export async function hashStoredFile(supabase: any, path: string): Promise<{ sha256: string; size: number } | null> {
  try {
    const { data, error } = await supabase.storage.from(EVIDENCE_BUCKET).download(path);
    if (error || !data) return null;
    const bytes = new Uint8Array(await (data as Blob).arrayBuffer());
    return { sha256: sha256Hex(bytes), size: bytes.byteLength };
  } catch {
    return null;
  }
}

/**
 * Fingerprints evidence as it's received, so a later case file can show the file is
 * byte-for-byte what was uploaded. A file that can't be read is kept without a fingerprint.
 */
export async function withIntakeHashes<T extends { path: string }>(supabase: any, items: T[]): Promise<(T & { sha256: string | null; sha256_at: string | null })[]> {
  const at = new Date().toISOString();
  return Promise.all(
    items.map(async (item) => {
      const h = await hashStoredFile(supabase, item.path);
      return { ...item, sha256: h?.sha256 ?? null, sha256_at: h ? at : null };
    }),
  );
}
