// The node-execution vocabulary shared by the transition replay, the outcome
// parsers, and the station pods. Extracted from the retired in-process executor
// (the event-driven walk — spec 6-dark-factory FR6.9 — made the walk loop itself
// obsolete; the types it defined did not).

import type { FailureCategory } from "@re-cinq/lore-shared/error-classify.js";
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
   * What this node produced for the next node's brief — merged into the line's
   * args (the FR6.17 artifact channel) before the walk advances, which is how
   * the next station finds it in its params. Distinct from `extras`, which the
   * walk routes on and renders into trailers: an `extras`-only result reaches
   * the walk but never the downstream node.
   */
  args?: Record<string, string>;
  /**
   * LLM usage of the node's own model calls (stations without Postgres report
   * cost this way). `resultLine` lifts it onto the terminal line's claude-style
   * envelope fields; it is never serialized into the LORE_NODE_RESULT payload.
   */
  usage?: NodeLlmUsage;
  /**
   * WHY the node failed, on a `failed` outcome that the Floor classified rather
   * than the station reporting. Typed rather than stuffed into `extras` because
   * the walk routes on it (a permanent class must not spend a retry budget) and
   * it is persisted on the station run — a stringly bag would reach neither
   * with a compiler watching.
   */
  failureClass?: FailureCategory;
  /** The agent's own error text, capped, that produced `failureClass`. */
  failureDetail?: string;
}

export interface NodeContext {
  taskId: string;
  /** Per-attempt assembly run id — distinct across retries of one task. */
  assemblyRunId: string;
  branchName: string;
  gitDir: string;
  iteration: number;
  assemblyLineName: string;
}

export type NodeHandler = (
  node: AssemblyLineNode,
  ctx: NodeContext,
) => Promise<NodeResult>;
