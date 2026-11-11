import type { OrgKind } from "./rbac";

/** Modules that can be switched on or off per organisation. */
export const FEATURES = ["movement", "corridors", "sar", "isps", "cargo", "links"] as const;
export type Feature = (typeof FEATURES)[number];

export const FEATURE_LABEL: Record<Feature, string> = {
  movement: "Protected movement / Fleet and voyages",
  corridors: "Corridor Watch (corridors, jetty boarding, responders)",
  sar: "Search and rescue",
  isps: "ISPS Watch",
  cargo: "Cargo custody",
  links: "Shared access between organisations",
};

/** What each organisation type gets when no switches have been set (the behaviour before switches existed). */
export const DEFAULT_FEATURES: Record<OrgKind, Feature[]> = {
  land: ["movement", "corridors", "sar", "cargo", "links"],
  maritime_operator: ["movement", "corridors", "sar", "cargo", "isps", "links"],
  port_facility: ["movement", "corridors", "sar", "cargo", "isps", "links"],
  authority: ["isps", "links"],
  responder: ["links"],
};

export function effectiveFeatures(kind: OrgKind, set: string[] | null | undefined): Feature[] {
  if (!set) return DEFAULT_FEATURES[kind] ?? [];
  return FEATURES.filter((f) => set.includes(f));
}
