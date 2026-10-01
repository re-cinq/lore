// Single record for all human station types; failures on adds prevent silent misses.

export type HumanStationType = "feature_review" | "pr_review" | "ci_check";

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
    whyParked:
      "Parked — waiting for you: open the plan to refine or approve it.",
  },
  pr_review: {
    label: "Waiting for the spec PR",
    phase: "awaiting-merge",
    whyParked: "Parked — waiting for the spec PR to merge.",
  },
  ci_check: {
    label: "Waiting for CI",
    phase: "awaiting-merge",
    whyParked: "Parked — waiting for the pull request's build to finish.",
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

/** What an open run waits on when only people hold it: the label of the human station its newest open visit is on. Null while a pod-run visit is open, or none is: then something is running, or nothing is. */
export function waitingOnPerson(
  definition: { nodes: readonly { id: string; type: string }[] } | null,
  visits: readonly { nodeId: string; outcome: string | null }[],
): string | null {
  const held = visits
    .filter((visit) => visit.outcome === null)
    .map((visit) => humanStation(nodeTypeOf(definition, visit.nodeId)));

  return held.every((meta) => meta !== null)
    ? (held.at(-1)?.label ?? null)
    : null;
}

/** The type the definition gives a node, or undefined for a node it does not know. */
export function nodeTypeOf(
  definition: { nodes: readonly { id: string; type: string }[] } | null,
  nodeId: string,
): string | undefined {
  const nodes = definition?.nodes ?? [];
  const node = nodes.find((known) => known.id === nodeId);

  return node?.type;
}
