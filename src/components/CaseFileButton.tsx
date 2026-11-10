import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileCheck2, Loader2 } from "lucide-react";
import { createCaseFile } from "@/lib/casefile.functions";

/** Freezes an incident, voyage or consignment into a court-ready case file and opens it. */
export function CaseFileButton({ kind, id, className = "b b-sm b-sec" }: { kind: "incident" | "voyage" | "consignment"; id: string; className?: string }) {
  const fn = useServerFn(createCaseFile);
  const navigate = useNavigate();
  const m = useMutation({
    mutationFn: () => fn({ data: { kind, id } }),
    onSuccess: (r) => navigate({ to: "/app/case-files/$id", params: { id: r.id } }),
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <button type="button" className={className} onClick={() => m.mutate()} disabled={m.isPending} title="Fingerprint every file and freeze this record into a case file for court, police or insurers">
      {m.isPending ? <Loader2 size={14} className="animate-spin" /> : <FileCheck2 size={14} />} {m.isPending ? "Fingerprinting files…" : "Case file"}
    </button>
  );
}
