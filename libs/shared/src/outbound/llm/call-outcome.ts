/** What one completed LLM call cost, in tokens, dollars and wall time — the row every provider logs. */
export interface LlmCallOutcome {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
}
