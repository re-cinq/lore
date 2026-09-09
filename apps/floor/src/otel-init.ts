/** Import this module FIRST in the entrypoint, before any other imports — @opentelemetry/api needs this registered TracerProvider or manual spans are no-ops. */

import { NodeSDK } from "@opentelemetry/sdk-node";

let sdk: NodeSDK | null = null;

export async function initOtel(): Promise<void> {
  try {
    sdk = await buildCloudSdk();
    sdk.start();
    console.log("[otel] Tracing and metrics initialized → Cloud Monitoring");
  } catch {
    console.log("[otel] Cloud exporters not available, tracing disabled");
  }
}

/** The Cloud exporters are imported dynamically so a deployment without them fails here rather than at module load, which is what makes tracing optional. */
// eslint-disable-next-line re-lint/no-duplicate-code -- the Floor's own OTel bootstrap; the only home it could share with lore-api's copy is @re-cinq/lore-shared, which would drag the OpenTelemetry SDK into the lean MCP install ADR-032 exists to protect
async function buildCloudSdk(): Promise<NodeSDK> {
  const { TraceExporter } =
    await import("@google-cloud/opentelemetry-cloud-trace-exporter");
  const { MetricExporter } =
    await import("@google-cloud/opentelemetry-cloud-monitoring-exporter");
  const { PeriodicExportingMetricReader } =
    await import("@opentelemetry/sdk-metrics");

  return new NodeSDK({
    traceExporter: new TraceExporter(),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new MetricExporter(),
      exportIntervalMillis: 60_000,
    }),
    serviceName: "lore-floor",
  });
}

export async function shutdownOtel(): Promise<void> {
  // Telemetry is best-effort — a failed export flush must never crash the process.
  if (sdk) {
    await sdk
      .shutdown()
      .catch((err) =>
        console.warn(`[otel] shutdown flush failed: ${(err as Error).message}`),
      );
  }
}
