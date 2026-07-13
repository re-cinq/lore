/**
 * Heavy OpenTelemetry SDK bootstrap for the Floor — the only consumer of
 * `@opentelemetry/sdk-node` and the Cloud exporters. Without this the manual
 * spans (the HTTP request-tracing extension, `auto_merge.decision`,
 * `lease.expired`) are no-ops: `@opentelemetry/api` needs a registered
 * TracerProvider to record anything.
 *
 * Import this module FIRST in the entrypoint — before any other imports.
 * Mirrors apps/lore-api's otel-init; the Cloud exporter imports fail soft
 * (caught) in environments without Cloud credentials (local dev).
 */

import { NodeSDK } from "@opentelemetry/sdk-node";

let sdk: NodeSDK | null = null;

export async function initOtel(): Promise<void> {
  try {
    const { TraceExporter } =
      await import("@google-cloud/opentelemetry-cloud-trace-exporter");
    const { MetricExporter } =
      await import("@google-cloud/opentelemetry-cloud-monitoring-exporter");
    const { PeriodicExportingMetricReader } =
      await import("@opentelemetry/sdk-metrics");

    sdk = new NodeSDK({
      traceExporter: new TraceExporter(),
      metricReader: new PeriodicExportingMetricReader({
        exporter: new MetricExporter(),
        exportIntervalMillis: 60_000,
      }),
      serviceName: "lore-floor",
    });
    sdk.start();
    console.log("[otel] Tracing and metrics initialized → Cloud Monitoring");
  } catch {
    console.log("[otel] Cloud exporters not available, tracing disabled");
  }
}

export async function shutdownOtel(): Promise<void> {
  // A failed export flush (e.g. no GCP project ID in an unauthed env) must never
  // crash the process — telemetry is best-effort.
  if (sdk) {
    await sdk
      .shutdown()
      .catch((err) =>
        console.warn(`[otel] shutdown flush failed: ${(err as Error).message}`),
      );
  }
}
