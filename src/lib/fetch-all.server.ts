// Reads every row of a query, a page at a time. Supabase returns at most 1,000 rows per request,
// so reports that count records must page through them rather than trust a single request.
const PAGE = 1000;

export async function fetchAll<T = any>(make: () => any, cap = 100_000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < cap; from += PAGE) {
    const { data, error } = await make().range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
  throw new Error(`More than ${cap} records. Choose a shorter period.`);
}
