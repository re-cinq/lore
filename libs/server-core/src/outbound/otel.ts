/** Light OpenTelemetry helpers: the spans lore-api and the adapter emit, with their metric half recorded through the shared instruments (`@re-cinq/lore-shared/otel/metrics.js`). No-ops until an SDK is registered. */

import { trace } from "@opentelemetry/api";
import {
  isGapCandidate,
  recordEpisodeWritten,
  recordRetrieval,
  recordTaskCreated,
  recordToolCall,
  traceHttp,
} from "@re-cinq/lore-shared/otel/metrics.js";

export { isGapCandidate, traceHttp };

const tracer = trace.getTracer("lore");

export function traceTool(call: {
  tool: string;
  durationMs: number;
  success: boolean;
}): void {
  const { tool, durationMs, success } = call;
  const span = tracer.startSpan(`tool/${tool}`);

  span.setAttributes({
    "lore.tool": tool,
    "lore.duration_ms": durationMs,
    "lore.success": success,
  });
  span.end();
  recordToolCall(call);
}

export function traceTaskCreated(taskType: string, repo: string): void {
  recordTaskCreated(taskType, repo);
}

export function traceEpisodeWritten(source: string): void {
  recordEpisodeWritten(source);
}

export function traceRetrieval(params: {
  query: string;
  namespace: string;
  topScore: number;
  resultCount: number;
}): void {
  recordRetrievalSpan(params);
  recordRetrieval(params.namespace, params.topScore);
}

// One span per retrieval, carrying what was asked and how well it was answered. `gap_candidate` is recorded ON the span as well as counted, so a trace explains its own metric.
function recordRetrievalSpan(params: {
  query: string;
  namespace: string;
  topScore: number;
  resultCount: number;
}): void {
  const span = tracer.startSpan("lore_search_context");

  span.setAttributes({
    "lore.query": params.query,
    "lore.namespace": params.namespace,
    "lore.top_score": params.topScore,
    "lore.result_count": params.resultCount,
    "lore.gap_candidate": isGapCandidate(params.topScore),
  });
  span.end();
}
