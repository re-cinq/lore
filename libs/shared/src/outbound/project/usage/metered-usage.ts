// The UsagePort every provider logs to, with the metric half added: one call recorded on the `lore.llm.*` instruments, then the row written as before. Decorating the sink rather than each provider keeps one recording site for every vendor.

import { recordLlmCall } from "../../otel/metrics.js";
import type { LlmCallRecord, UsagePort } from "./usage-port.js";

export function meteredUsage(usage: UsagePort): UsagePort {
  return {
    logLlmCall(record: LlmCallRecord) {
      recordLlmCall({
        model: record.model,
        inputTokens: record.inputTokens,
        outputTokens: record.outputTokens,
        cacheReadTokens: record.cacheReadTokens ?? 0,
        cacheWriteTokens: record.cacheWriteTokens ?? 0,
        costUsd: record.costUsd ?? 0,
        status: record.status ?? "success",
      });

      return usage.logLlmCall(record);
    },
    processedCounts: () => usage.processedCounts(),
    modelsUsed: (stationRunId) => usage.modelsUsed(stationRunId),
  };
}
