/**
 * One `pipeline.llm_calls` row — a single LLM invocation's token + cost
 * accounting. Written by the runner's agent node after each completion.
 */
export interface LlmCallRecord {
  taskId?: string | null;
  jobName: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Defaults to 0 when the provider tracks cost internally (e.g. Claude Code). */
  costUsd?: number;
  durationMs: number;
}

/** Today's and all-time `pipeline.llm_calls` row counts (health readout). */
export interface ProcessedCounts {
  today: number;
  total: number;
}

/** The LLM-usage accounting surface. */
export interface UsagePort {
  logLlmCall(record: LlmCallRecord): Promise<void>;
  processedCounts(): Promise<ProcessedCounts>;
}
