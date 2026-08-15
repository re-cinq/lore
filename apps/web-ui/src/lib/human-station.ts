// Everything web-ui knows about the stations a PERSON works (FR6.40), in one
// record. The set used to be enumerated four times — a budget set, a badge map,
// a phase map, and an inline `type === "pr_review"` compare — so adding a third
// human station type meant four edits and a silent miss rendered a parked node
// with an "overdue" countdown. Now the union gains a member and every consumer
// fails typecheck until this record answers for it.
//
// A hand mirror of `HUMAN_STATION_TYPES` in @re-cinq/lore-assembly-lines (web-ui
// cannot import libs); the union is guarded by `scripts/type-drift/run-graph.drift.ts`.

export type HumanStationType = "feature_review" | "pr_review";

export interface HumanStationMeta {
  /** The run badge: whose move it is. */
  label: string;
  /** The wizard phase a run parked here reports. */
  phase: "awaiting-author" | "awaiting-merge";
  /** The detail panel's answer to "why is nothing happening". */
  whyParked: string;
}

export const HUMAN_STATIONS: Record<HumanStationType, HumanStationMeta> = {
  feature_review: {
    label: "Waiting for you",
    phase: "awaiting-author",
    whyParked: "Parked — waiting for you to review this round.",
  },
  pr_review: {
    label: "Waiting for the spec PR",
    phase: "awaiting-merge",
    whyParked: "Parked — waiting for the spec PR to merge.",
  },
};

/** The meta for a node type, or null when its worker is a pod, not a person. */
export function humanStation(
  nodeType: string | null | undefined,
): HumanStationMeta | null {
  return nodeType && nodeType in HUMAN_STATIONS
    ? HUMAN_STATIONS[nodeType as HumanStationType]
    : null;
}
