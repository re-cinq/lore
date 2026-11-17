// The usage row and log line every HTTP-backed provider writes after a call, successful or failed.

import type { LlmCallRecord, UsagePort } from "../project/usage/usage-port.js";

export interface LlmCallMetrics {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  costUsd: number;
  durationMs: number;
}

export interface CallIdentity {
  taskId?: string;
  jobName?: string;
}

/** One call that threw: who asked, on which model, since when, and which log kind to report it under. */
export interface FailedAttempt {
  req: CallIdentity;
  model: string;
  start: number;
  kind: string;
}

/** Writes the success row and the log line; a usage store that throws never fails the call. */
export async function recordCall(
  usage: UsagePort | undefined,
  req: CallIdentity,
  kind: string,
  metrics: LlmCallMetrics,
): Promise<void> {
  if (usage) {
    const result = await usage
      .logLlmCall(usageLogEntry(req, metrics))
      .catch(() => null);

    warnIfUncorrelated(result, req.taskId);
  }
  console.log(
    `[llm] ${kind}: ${metrics.model} ${metrics.inputTokens}+${metrics.outputTokens} tokens $${metrics.costUsd.toFixed(4)} ${metrics.durationMs}ms`,
  );
}

export async function recordFailure(
  usage: UsagePort | undefined,
  attempt: FailedAttempt,
  err: unknown,
): Promise<void> {
  console.error(`[llm] ${attempt.kind} failed:`, err);
  await usage
    ?.logLlmCall(failedCallRecord(attempt, (err as Error).message))
    .catch(() => null);
}

function usageLogEntry(
  req: CallIdentity,
  metrics: LlmCallMetrics,
): LlmCallRecord {
  return {
    taskId: req.taskId || null,
    jobName: req.jobName || null,
    model: metrics.model,
    inputTokens: metrics.inputTokens,
    outputTokens: metrics.outputTokens,
    cacheReadTokens: metrics.cacheReadTokens,
    costUsd: metrics.costUsd,
    durationMs: metrics.durationMs,
  };
}

function failedCallRecord(
  attempt: FailedAttempt,
  message: string,
): LlmCallRecord {
  return {
    taskId: attempt.req.taskId || null,
    jobName: attempt.req.jobName || null,
    model: attempt.model,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    durationMs: Date.now() - attempt.start,
    status: "failed",
    error: message,
  };
}

function warnIfUncorrelated(
  result: { correlated: boolean } | null,
  taskId?: string,
): void {
  if (!result || result.correlated || !taskId) {
    return;
  }
  console.warn(
    `[llm] cost row uncorrelated: id ${taskId} matched no pipeline.tasks or pipeline.assembly_runs row`,
  );
}
