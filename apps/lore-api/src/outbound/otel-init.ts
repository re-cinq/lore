// The OTel SDK of the remote app: traces to OTLP/HTTP or Cloud Trace, metrics served to Prometheus on the `metrics` port. Imported FIRST in the entrypoint and started before any instrument is touched.

import { NodeSDK } from "@opentelemetry/sdk-node";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  metricsPortFromEnv,
  prometheusReader,
} from "@re-cinq/lore-shared/otel/prometheus-metrics.js";
import {
  traceExporterKind,
  type TraceExporterKind,
} from "./trace-exporter-kind.js";

let sdk: NodeSDK | null = null;

// No telemetry failure may take the API down: a port already bound or a missing exporter leaves the app running unobserved, and says so once.
export async function initOtel(): Promise<void> {
  const port = metricsPortFromEnv(process.env);

  try {
    const kind = traceExporterKind(process.env);

    sdk = new NodeSDK({
      traceExporter: await traceExporter(kind),
      metricReader: prometheusReader(port),
      serviceName: "lore-api",
    });
    sdk.start();
    console.log(
      `[otel] traces → ${TRACE_DESTINATIONS[kind]}, metrics on :${port}/metrics`,
    );
  } catch (err) {
    sdk = null;
    console.error(
      `[otel] telemetry disabled: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

const TRACE_DESTINATIONS: Record<TraceExporterKind, string> = {
  otlp: "OTLP/HTTP",
  "cloud-trace": "Cloud Trace",
  none: "nowhere (disabled)",
};

async function traceExporter(
  kind: TraceExporterKind,
): Promise<SpanExporter | undefined> {
  if (kind === "none") {
    return undefined;
  }

  if (kind === "otlp") {
    const { OTLPTraceExporter } =
      await import("@opentelemetry/exporter-trace-otlp-http");

    return new OTLPTraceExporter();
  }

  return cloudTraceExporter();
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
