/** How long the reaper waits for one node before presuming it dead: YAML wins where it speaks, else the station's declared budget, else the global default (a poor fit for service nodes, e.g. a 5-minute `merge_step` sitting un-reaped for sixty-two). */

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

/** The declared budget of the station claiming this node type, if any — read from the manifest rather than restated Floor-side. */
export function stationBudgetFor(nodeType: string): number | undefined {
  const trigger = nodeStationFor(nodeType)?.manifest.triggers.find(
    (t) => t.kind === "node" && t.nodeType === nodeType,
  );

  return trigger?.kind === "node" ? trigger.timeoutMinutes : undefined;
}
