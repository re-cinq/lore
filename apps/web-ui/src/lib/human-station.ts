// Single record for all human station types; failures on adds prevent silent misses.

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
