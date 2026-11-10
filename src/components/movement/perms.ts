import { createContext, useContext } from "react";
import type { SpecRole } from "@/lib/rbac";

/**
 * Who can change what on Protected movement (matches the database rules):
 *   Security Manager — people, boats, consent, tracking, tracker links, zones
 *   Operator         — voyages, head counts, acknowledging alerts
 *   Client Admin     — view only
 */
export type MovementPerms = { canManage: boolean; canOperate: boolean };

export function movementPerms(role: SpecRole | undefined): MovementPerms {
  const canManage = role === "security_manager";
  return { canManage, canOperate: canManage || role === "operator" };
}

export const MovementPermsContext = createContext<MovementPerms>({ canManage: false, canOperate: false });
export const useMovementPerms = () => useContext(MovementPermsContext);
