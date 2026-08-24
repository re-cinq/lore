/**
 * How long the reaper waits for one node before presuming it dead.
 *
 * Three sources, in order. The YAML wins where it speaks, because a line may
 * deliberately extend a step. Where it is silent — as every `merge.yaml` node
 * is — the STATION's own declared budget answers, since the station is what
 * knows how long its work takes. The global default is the last resort, and it
 * is a poor one for service nodes: a `merge_step` declaring five minutes would
 * otherwise sit un-reaped for sixty-two.
 */

import { nodeStationFor } from "@re-cinq/lore-stations";

export interface NodeTimeoutInput {
  /** `timeout_minutes` from the line's YAML, when it declares one. */
  yaml: number | undefined;
  /** `timeoutMinutes` from the station manifest claiming this node type. */
  manifest: number | undefined;
}

export const nodeTimeoutMinutes = ({
  yaml,
  manifest,
}: NodeTimeoutInput): number | undefined => yaml ?? manifest;

/**
 * The declared budget of the station claiming this node type, if any.
 *
 * Read from the manifest rather than restated Floor-side: the budget belongs to
 * the station that has to finish inside it.
 */
export function stationBudgetFor(nodeType: string): number | undefined {
  const trigger = nodeStationFor(nodeType)
    ?.manifest.triggers.find((t) => t.kind === "node" && t.nodeType === nodeType);

  return trigger?.kind === "node" ? trigger.timeoutMinutes : undefined;
}
