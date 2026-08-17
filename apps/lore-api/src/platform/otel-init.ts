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
  // The API server always exports telemetry. The dynamic exporter imports below
  // fail soft (caught) in environments without Cloud credentials (local dev).
  try {
    // Dynamic imports — these packages may not be installed in Phase 0
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
      serviceName: "lore-api",
    });
    sdk.start();
    console.log("[otel] Tracing and metrics initialized → Cloud Monitoring");
  } catch {
    console.log("[otel] Cloud exporters not available, tracing disabled");
  }
}

/**
 * Flush and stop the SDK. Rejects if the export fails — deliberately.
 *
 * A failed flush (an unauthed environment has no GCP project id) must not crash
 * the process, but the swallowing belongs to ONE owner:
 * `shutdownGracefully`, where the best-effort contract is stated and tested.
 * Catching here as well left that outer handler dead for the only real call path,
 * so the test that covers it would have been exercising nothing but its own fake.
 */
export async function shutdownOtel(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
  }
}
