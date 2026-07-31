// The node-execution vocabulary shared by the transition replay, the outcome
// parsers, and the station pods. Extracted from the retired in-process executor
// (the event-driven walk — spec 6-dark-factory FR6.9 — made the walk loop itself
// obsolete; the types it defined did not).

import type { AssemblyLineNode } from "./loader.js";

export type StageOutcome = "success" | "changes_requested" | "failed";

/**
 * LLM usage a station reports for cost accounting — exactly the fields the
 * `/api/agent-events` cost sink reads off a terminal result event. Structurally
 * a subset of the shared `LlmUsage`, so a station can assign one directly.
 * Cache tokens are deliberately absent: the provider already folds them into
 * `costUsd`, and the sink's `LlmCallRow` does not track them separately.
 */
export interface NodeLlmUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  model: string;
}

export interface NodeResult {
  outcome: StageOutcome;
  /** Free-form extras (e.g. `Lore-Cost-Tokens`, `Lore-Validation-Status`). */
  extras?: Record<string, string>;
  /**
   * LLM usage of the node's own model calls (stations without Postgres report
   * cost this way). `resultLine` lifts it onto the terminal line's claude-style
   * envelope fields; it is never serialized into the LORE_NODE_RESULT payload.
   */
  usage?: NodeLlmUsage;
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
