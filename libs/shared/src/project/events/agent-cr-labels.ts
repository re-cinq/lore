// The labels an Agent CR carries, as a CONTRACT between two services.
//
// The Floor stamps these when it dispatches a CR; the event-router reads them
// back off a terminal CR to say which (run, node, iteration) finished. Those are
// now separate deployables, so the label names are a wire format — one side
// renaming a string it thought it owned would silently stop the other side from
// recognising its own work. They live here for the same reason the event names
// do: shared vocabulary belongs to neither speaker.
//
// The CR name only carries a 12-char prefix of the run id, which is why the full
// identity has to ride in labels at all.

/** The run this CR belongs to. Written on every CR since the writer flip
 *  (#1255, deployed 2026-08-17). */
export const ASSEMBLY_RUN_ID_LABEL = "lore.re-cinq.com/assembly-run-id";

/** No longer written — kept as a READER for CRs created before the flip, which
 *  can outlive a rollout by up to a node's whole timeout (FR6.44). */
export const LEGACY_ASSEMBLY_LINE_ID_LABEL =
  "lore.re-cinq.com/assembly-line-id";

export const NODE_ID_LABEL = "lore.re-cinq.com/node-id";
export const NODE_ITERATION_LABEL = "lore.re-cinq.com/node-iteration";

/** The station run this pod IS (FR6.39). The three labels above name the visit
 *  compositely; this one names it outright, so a pod found in the cluster maps
 *  back to its telemetry without re-deriving anything from the CR name. */
export const STATION_RUN_ID_LABEL = "lore.re-cinq.com/station-run-id";

/** The task the CR serves. Every CR carries it, including the synthetic one an
 *  assembly-line node runs under. */
export const TASK_ID_LABEL = "lore.re-cinq.com/task-id";
