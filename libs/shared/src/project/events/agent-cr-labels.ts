// Agent CR labels are a wire contract between Floor (writer) and event-router (reader).

/** The run this CR belongs to. Written since #1255. */
export const ASSEMBLY_RUN_ID_LABEL = "lore.re-cinq.com/assembly-run-id";

/** Kept as reader for legacy CRs outliving rollouts (FR6.44). */
export const LEGACY_ASSEMBLY_LINE_ID_LABEL =
  "lore.re-cinq.com/assembly-line-id";

export const NODE_ID_LABEL = "lore.re-cinq.com/node-id";
export const NODE_ITERATION_LABEL = "lore.re-cinq.com/node-iteration";

/** The station run this pod IS (FR6.39): enables cluster pod-to-telemetry mapping. */
export const STATION_RUN_ID_LABEL = "lore.re-cinq.com/station-run-id";

/** The task the CR serves: every CR carries it, including synthetic assembly-line CRs. */
export const TASK_ID_LABEL = "lore.re-cinq.com/task-id";
