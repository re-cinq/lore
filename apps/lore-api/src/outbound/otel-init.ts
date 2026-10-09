// The OTel SDK of the remote app: traces to Cloud Trace, metrics served to Prometheus on the `metrics` port. Imported FIRST in the entrypoint and started before any instrument is touched.

import { NodeSDK } from "@opentelemetry/sdk-node";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  metricsPortFromEnv,
  prometheusReader,
} from "@re-cinq/lore-shared/otel/prometheus-metrics.js";

let sdk: NodeSDK | null = null;

// No telemetry failure may take the API down: a port already bound or a missing exporter leaves the app running unobserved, and says so once.
export async function initOtel(): Promise<void> {
  const port = metricsPortFromEnv(process.env);

  try {
    sdk = new NodeSDK({
      traceExporter: await cloudTraceExporter(),
      metricReader: prometheusReader(port),
      serviceName: "lore-api",
    });
    sdk.start();
    console.log(`[otel] traces → Cloud Trace, metrics on :${port}/metrics`);
  } catch (err) {
    sdk = null;
    console.error(
      `[otel] telemetry disabled: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function cloudTraceExporter(): Promise<SpanExporter | undefined> {
  try {
    const { TraceExporter } =
      await import("@google-cloud/opentelemetry-cloud-trace-exporter");

    return new TraceExporter();
  } catch {
    console.log("[otel] Cloud Trace exporter not available, tracing disabled");

    return undefined;
  }
}

// Deliberately rejects on export failures; outer shutdownGracefully handles errors (ADR-025 or similar)
export async function shutdownOtel(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
  }
}
