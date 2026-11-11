// Shared by the server (to fingerprint) and the case file (to export): the exact text of a
// statement whose SHA-256 is stored. Changing this format would break old fingerprints.

export type VoyageRecord = {
  id: string;
  voyage_id: string;
  kind: "statement" | "media";
  given_by_name: string | null;
  given_by_role: string | null;
  given_by_contact: string | null;
  statement: string | null;
  path: string | null;
  file_name: string | null;
  mime: string | null;
  size_bytes: number | null;
  caption: string | null;
  sha256: string;
  taken_at: string;
  recorded_by_name: string | null;
  created_at: string;
};

export function statementText(r: { given_by_name: string | null; given_by_role: string | null; given_by_contact: string | null; statement: string | null; taken_at: string; recorded_by_name: string | null }) {
  return [
    "STATEMENT",
    `Given by: ${r.given_by_name ?? ""}`,
    `Role: ${r.given_by_role ?? ""}`,
    `Contact: ${r.given_by_contact ?? ""}`,
    `Taken at (UTC): ${new Date(r.taken_at).toISOString()}`,
    `Recorded by: ${r.recorded_by_name ?? ""}`,
    "",
    r.statement ?? "",
    "",
  ].join("\n");
}
