/**
 * Heavy OpenTelemetry SDK bootstrap — the only consumer of
 * `@opentelemetry/sdk-node` and the Cloud exporters. Lives in the remote app's
 * boot path; the local MCP adapter never calls this, so it never pulls the
 * heavy SDK. The light trace/metric emitters live in
 * `@re-cinq/lore-server-core/platform/otel.js`.
 *
 * Import this module FIRST in the remote entrypoint — before any other imports.
 */

import { NodeSDK } from "@opentelemetry/sdk-node";

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

export async function shutdownOtel(): Promise<void> {
  if (sdk) await sdk.shutdown();
}
