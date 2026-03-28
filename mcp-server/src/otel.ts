/**
 * OpenTelemetry setup for the Lore MCP server.
 *
 * Exports traces and metrics to Cloud Monitoring when running on GKE.
 * No-ops gracefully when OTEL is not configured (Phase 0 local mode).
 *
 * Import this module FIRST in index.ts — before any other imports.
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { trace, metrics, Span } from "@opentelemetry/api";

let sdk: NodeSDK | null = null;

export async function initOtel(): Promise<void> {
  // Only initialize when running in HTTP mode (GKE)
  if (process.env.MCP_TRANSPORT !== "http") return;

  try {
    // Dynamic imports — these packages may not be installed in Phase 0
    const { TraceExporter } = await import(
      "@google-cloud/opentelemetry-cloud-trace-exporter"
    );
    const { MetricExporter } = await import(
      "@google-cloud/opentelemetry-cloud-monitoring-exporter"
    );
    const { PeriodicExportingMetricReader } = await import(
      "@opentelemetry/sdk-metrics"
    );

    sdk = new NodeSDK({
      traceExporter: new TraceExporter(),
      metricReader: new PeriodicExportingMetricReader({
        exporter: new MetricExporter(),
        exportIntervalMillis: 60_000,
      }),
      serviceName: "lore-mcp",
    });
    sdk.start();
    console.log("[otel] Tracing and metrics initialized → Cloud Monitoring");
  } catch (err) {
    console.log("[otel] Cloud exporters not available, tracing disabled");
  }
}

const GAP_THRESHOLD = 0.72;
const tracer = trace.getTracer("lore-mcp");
const meter = metrics.getMeter("lore-mcp");
const retrievalHistogram = meter.createHistogram("lore.retrieval.score", {
  description: "Top retrieval score per search call",
});
const retrievalCounter = meter.createCounter("lore.retrieval.count", {
  description: "Total retrieval calls",
});
const gapCounter = meter.createCounter("lore.retrieval.gap_candidates", {
  description: "Low-confidence retrievals (potential gaps)",
});

export function traceRetrieval(params: {
  query: string;
  namespace: string;
  topScore: number;
  resultCount: number;
}): void {
  const span = tracer.startSpan("search_context");
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

export async function shutdownOtel(): Promise<void> {
  if (sdk) await sdk.shutdown();
}
