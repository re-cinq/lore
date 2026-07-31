/**
 * One `pipeline.llm_calls` row — a single LLM invocation's token + cost
 * accounting. Written by the runner's agent node after each completion.
 */
export interface LlmCallRecord {
  taskId?: string | null;
  /** The Agent CR name (`source.agent`). When it resolves to an
   *  `assembly_line_nodes` row, the cost lands on that exact assembly-line
   *  attempt — giving task-backed runs per-attempt cost (#947). */
  agentCrName?: string | null;
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
  /** True when the row landed on a task or an assembly line; false when the
   *  incoming id matched neither, so the row is stored uncorrelated (both
   *  columns null). The ingest sink surfaces the false case (issue #945). */
  correlated: boolean;
}

/** The LLM-usage accounting surface. */
export interface UsagePort {
  logLlmCall(record: LlmCallRecord): Promise<LlmCallResult>;
  processedCounts(): Promise<ProcessedCounts>;
}
