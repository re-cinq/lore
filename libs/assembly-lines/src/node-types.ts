// The node-execution vocabulary shared by the transition replay, the outcome
// parsers, and the station pods. Extracted from the retired in-process executor
// (the event-driven walk — spec 6-dark-factory FR6.9 — made the walk loop itself
// obsolete; the types it defined did not).

import type { AssemblyLineNode } from "./loader.js";

export type StageOutcome = "success" | "changes_requested" | "failed";

export interface NodeResult {
  outcome: StageOutcome;
  /** Free-form extras (e.g. `Lore-Cost-Tokens`, `Lore-Validation-Status`). */
  extras?: Record<string, string>;
}

export interface NodeContext {
  taskId: string;
  /** Per-attempt assembly line id — distinct across retries of one task. */
  assemblyLineId: string;
  branchName: string;
  gitDir: string;
  iteration: number;
  assemblyLineName: string;
}

export type NodeHandler = (
  node: AssemblyLineNode,
  ctx: NodeContext,
) => Promise<NodeResult>;
