// Serves every instrument of this process as Prometheus text on its own port, the one the chart names `metrics` and the ServiceMonitor scrapes.

import { metrics } from "@opentelemetry/api";
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { MeterProvider } from "@opentelemetry/sdk-metrics";
import { resourceFromAttributes } from "@opentelemetry/resources";

export const DEFAULT_METRICS_PORT = 9464;

export interface PrometheusMetricsOptions {
  serviceName: string;
  port?: number;
}

export interface PrometheusMetrics {
  port: number;
  stop: () => Promise<void>;
}

/** The reader a NodeSDK takes as its `metricReader`; lore-api hands it in beside its trace exporter instead of starting a second provider. */
export function prometheusReader(
  port = DEFAULT_METRICS_PORT,
): PrometheusExporter {
  return new PrometheusExporter({ port });
}

/** For a process with no NodeSDK (the stations service, the MCP gateway): one MeterProvider, registered globally so the instruments in metrics.ts start recording. */
export function startPrometheusMetrics(
  options: PrometheusMetricsOptions,
): PrometheusMetrics {
  const port = options.port ?? DEFAULT_METRICS_PORT;
  const reader = prometheusReader(port);
  const provider = new MeterProvider({
    resource: resourceFromAttributes({ "service.name": options.serviceName }),
    readers: [reader],
  });

  metrics.setGlobalMeterProvider(provider);
  console.log(`[otel] ${options.serviceName} metrics on :${port}/metrics`);

  return { port, stop: () => provider.shutdown() };
}

export function metricsPortFromEnv(env: NodeJS.ProcessEnv): number {
  const raw = env.LORE_METRICS_PORT;

  return raw ? Number(raw) : DEFAULT_METRICS_PORT;
}
