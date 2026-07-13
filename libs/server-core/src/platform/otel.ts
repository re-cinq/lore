/**
 * Light OpenTelemetry helpers — trace/metric emitters built on the
 * `@opentelemetry/api` surface only. These are no-ops until an SDK is
 * registered globally (the heavy `initOtel` lives in the remote app's boot,
 * in its `otel-init.ts`). Both the local MCP adapter and the remote API import
 * these helpers; neither pulls the heavy `@opentelemetry/sdk-node`.
 */

import { trace, metrics } from "@opentelemetry/api";

const GAP_THRESHOLD = 0.72;
const tracer = trace.getTracer("lore");
const meter = metrics.getMeter("lore");
const retrievalHistogram = meter.createHistogram("lore.retrieval.score", {
  description: "Top retrieval score per search call",
});
const retrievalCounter = meter.createCounter("lore.retrieval.count", {
  description: "Total retrieval calls",
});
const gapCounter = meter.createCounter("lore.retrieval.gap_candidates", {
  description: "Low-confidence retrievals (potential gaps)",
});

// ── Tool + HTTP metrics ─────────────────────────────────────────────

const toolLatency = meter.createHistogram("lore.tool.duration_ms", {
  description: "MCP tool call duration in milliseconds",
  unit: "ms",
});
const toolCounter = meter.createCounter("lore.tool.calls", {
  description: "Total MCP tool calls",
});
const toolErrors = meter.createCounter("lore.tool.errors", {
  description: "MCP tool call errors",
});
const httpLatency = meter.createHistogram("lore.http.duration_ms", {
  description: "HTTP request duration in milliseconds",
  unit: "ms",
});
const httpCounter = meter.createCounter("lore.http.requests", {
  description: "Total HTTP requests",
});
const taskCounter = meter.createCounter("lore.tasks.created", {
  description: "Pipeline tasks created",
});
const episodeCounter = meter.createCounter("lore.episodes.written", {
  description: "Episodes written",
});

export function traceTool(
  tool: string,
  durationMs: number,
  success: boolean,
): void {
  const span = tracer.startSpan(`tool/${tool}`);
  span.setAttributes({
    "lore.tool": tool,
    "lore.duration_ms": durationMs,
    "lore.success": success,
  });
  span.end();

  toolLatency.record(durationMs, { tool });
  toolCounter.add(1, { tool, success: String(success) });
  if (!success) toolErrors.add(1, { tool });
}

export function traceHttp(
  method: string,
  path: string,
  statusCode: number,
  durationMs: number,
): void {
  httpLatency.record(durationMs, { method, path: normalizePath(path) });
  httpCounter.add(1, {
    method,
    path: normalizePath(path),
    status: String(statusCode),
  });
}

export function traceTaskCreated(taskType: string, repo: string): void {
  taskCounter.add(1, { task_type: taskType, repo });
}

export function traceEpisodeWritten(source: string): void {
  episodeCounter.add(1, { source });
}

function normalizePath(path: string): string {
  // Collapse UUIDs and IDs to keep cardinality low
  return path
    .replace(/\/[0-9a-f-]{36}/g, "/:id")
    .replace(/\?.*/, "")
    .split("/")
    .slice(0, 3)
    .join("/");
}

export function traceRetrieval(params: {
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
    "lore.gap_candidate": params.topScore < GAP_THRESHOLD,
  });
  span.end();

  retrievalHistogram.record(params.topScore, {
    namespace: params.namespace,
  });
  retrievalCounter.add(1, { namespace: params.namespace });

  if (params.topScore < GAP_THRESHOLD) {
    gapCounter.add(1, { namespace: params.namespace });
  }
}
