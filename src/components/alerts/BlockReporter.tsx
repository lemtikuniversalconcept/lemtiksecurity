import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { blockReporter } from "@/lib/telegram-reports.functions";

/** On a community report's incident: who sent it (by number only), and a way to stop their reports. */
export function CommunityReporterStrip({ description, canBlock }: { description: string | null; canBlock: boolean }) {
  const n = Number(/Sent by Reporter #(\d+) via Telegram/.exec(description ?? "")?.[1] ?? 0);
  const fn = useServerFn(blockReporter);
  const [blocked, setBlocked] = useState(false);
  const m = useMutation({
    mutationFn: (block: boolean) => fn({ data: { number: n, block } }),
    onSuccess: (_r, block) => { setBlocked(block); toast.success(block ? `Reports from Reporter #${n} are now refused.` : `Reporter #${n} can report again.`); },
    onError: (e) => toast.error((e as Error).message),
  });
  if (!n) return null;
  return (
    <div className="card row g8 wrap" style={{ padding: "8px 12px", fontSize: 12.5, alignItems: "center" }}>
      <span><b>Community report by Telegram</b> from Reporter #{n}. Not yet checked. Their identity isn't stored with the report.</span>
      <span className="f1" />
      {canBlock && <button type="button" className="b b-sm b-gh" disabled={m.isPending} onClick={() => m.mutate(!blocked)}>{blocked ? `Unblock Reporter #${n}` : `Block Reporter #${n}`}</button>}
    </div>
  );
}
