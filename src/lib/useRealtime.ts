import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Subscribe to postgres_changes on a table and invalidate matching query keys.
 */
export function useRealtimeInvalidate(table: string, queryKeys: string[][]) {
  const qc = useQueryClient();
  const channelId = useRef(crypto.randomUUID());
  useEffect(() => {
    const channel = supabase
      .channel(`realtime:${table}:${channelId.current}`)
      .on("postgres_changes", { event: "*", schema: "public", table }, () => {
        queryKeys.forEach((key) => qc.invalidateQueries({ queryKey: key }));
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, qc, queryKeys]);
}
