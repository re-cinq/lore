// Node-execution vocabulary shared by the transition replay, outcome parsers, and station pods — extracted from the retired in-process executor (spec 6-dark-factory FR6.9 obsoleted the walk loop, not the types it defined).

import type { FailureCategory } from "@re-cinq/lore-shared/error-classify.js";
import type { AssemblyLineNode } from "./loader.js";

export type StageOutcome = "success" | "changes_requested" | "failed";

// LLM usage a station reports for cost accounting — exactly the fields the /api/agent-events cost sink reads; a structural subset of shared LlmUsage. Cache tokens deliberately absent (provider folds them into costUsd, LlmCallRow doesn't track separately).
export interface NodeLlmUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  model: string;
}

export interface NodeResult {
  outcome: StageOutcome;
  // Free-form extras (e.g. `Lore-Cost-Tokens`, `Lore-Validation-Status`).
  extras?: Record<string, string>;
  // What this node produced for the next node's brief — merged into the line's args (FR6.17) before the walk advances; distinct from `extras`, which an `extras`-only result never reaches the downstream node through.
  args?: Record<string, string>;
  // LLM usage of the node's own model calls (Postgres-less stations report cost this way); resultLine lifts it onto the terminal envelope, never serialized into LORE_NODE_RESULT.
  usage?: NodeLlmUsage;
  // WHY the node failed, on a `failed` outcome the Floor classified rather than the station reporting; typed (not stuffed into `extras`) since the walk routes on it and it's persisted on the station run.
  failureClass?: FailureCategory;
  // The agent's own error text, capped, that produced `failureClass`.
  failureDetail?: string;
}

export interface NodeContext {
  taskId: string;
  // Per-attempt assembly run id — distinct across retries of one task.
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
