import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { listMyForensicQueries } from "@/lib/forensic.functions";

export const Route = createFileRoute("/forensic/queries")({
  component: QueriesPage,
});

function QueriesPage() {
  const list = useServerFn(listMyForensicQueries);
  const { data: queries = [], isLoading } = useQuery({ queryKey: ["forensic-my-queries"], queryFn: () => list() });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-[var(--tx-1)]">My AI queries</h1>
        <p className="text-sm text-[var(--tx-3)]">Every question you've asked the case AI assistant, and its answer, logged for your own reference.</p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-[var(--tx-3)]"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : queries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--line-2)] py-14 text-center text-sm text-[var(--tx-3)]">
          You haven't asked the AI assistant anything yet.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {(queries as any[]).map((q) => (
            <Link
              key={q.id}
              to="/forensic/cases/$id/ai"
              params={{ id: q.incident_id }}
              className="block rounded-lg border border-[var(--line-2)] bg-[var(--ink-2)] p-4 hover:border-[var(--blue)]"
            >
              <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--tx-3)]">
                <span>{new Date(q.created_at).toLocaleString()}</span>
                <span className="rounded-full bg-white/5 px-2 py-0.5">{q.response_mode}</span>
              </div>
              <div className="mt-1.5 text-sm text-[var(--tx-1)]">{q.query_text}</div>
              {q.response_text && <div className="mt-1 truncate text-xs text-[var(--tx-3)]">{q.response_text}</div>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
