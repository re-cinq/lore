import type { CarriedRunIdentity } from "../run-identity/carried-run-identity.js";

/** One pipeline.llm_calls row — a single LLM invocation's token+cost accounting, written by the runner's agent node after each completion. */
export interface LlmCallRecord {
  taskId?: string | null;
  /** The Agent CR name (source.agent); when it resolves to an assembly_line_nodes row, cost lands on that exact attempt (per-attempt cost, #947). */
  agentCrName?: string | null;
  /** Identity the event itself stated, if known (#1147); present skips both the CR-name lookup and the given-id fallback. */
  carried?: CarriedRunIdentity | null;
  jobName?: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Defaults to 0 when the provider tracks cost internally (e.g. Claude Code). */
  costUsd?: number;
  durationMs: number;
  /** Defaults to "success"; a failed API call records "failed" + `error`. */
  status?: "success" | "failed";
  error?: string | null;
}

/** Today's and all-time `pipeline.llm_calls` row counts (health readout). */
export interface ProcessedCounts {
  today: number;
  total: number;
}

/** Outcome of persisting one cost row. */
export interface LlmCallResult {
  /** True when the row landed on a task or assembly line; false when uncorrelated (both columns null) — the ingest sink surfaces the false case (#945). */
  correlated: boolean;
}

/** The LLM-usage accounting surface. */
export interface UsagePort {
  logLlmCall(record: LlmCallRecord): Promise<LlmCallResult>;
  processedCounts(): Promise<ProcessedCounts>;
  /** Distinct models billed against station run; reflects agent-definition override. */
  modelsUsed(stationRunId: string): Promise<string[]>;
}
