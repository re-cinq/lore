// Heavy OTel SDK bootstrap for remote app only; import FIRST in remote entrypoint

import { NodeSDK } from "@opentelemetry/sdk-node";

let sdk: NodeSDK | null = null;

export async function initOtel(): Promise<void> {
  // Dynamic exporter imports fail soft if Cloud credentials unavailable
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

// Deliberately rejects on export failures; outer shutdownGracefully handles errors (ADR-025 or similar)
export async function shutdownOtel(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
  }
}
