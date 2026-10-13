import { describe, expect, it } from "vitest";
import { metrics } from "@opentelemetry/api";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type DataPoint,
} from "@opentelemetry/sdk-metrics";
import { InMemoryUsage } from "./usage-memory.js";
import { meteredUsage } from "./metered-usage.js";

const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
const reader = new PeriodicExportingMetricReader({
  exporter,
  exportIntervalMillis: 60_000,
});

metrics.setGlobalMeterProvider(new MeterProvider({ readers: [reader] }));

describe("meteredUsage", () => {
  it("writes the gemini-2.5-flash row through and counts one call of 10 input tokens", async () => {
    const inner = new InMemoryUsage();
    const usage = meteredUsage(inner);

    await usage.logLlmCall({
      model: "gemini-2.5-flash",
      inputTokens: 10,
      outputTokens: 3,
      durationMs: 5,
    });

    const { resourceMetrics } = await reader.collect();
    const points = resourceMetrics.scopeMetrics
      .flatMap((scope) => scope.metrics)
      .filter((metric) => metric.descriptor.name === "lore.llm.tokens")
      .flatMap((metric) => metric.dataPoints as DataPoint<unknown>[])
      .filter((point) => point.attributes.kind === "input");

    expect(await inner.processedCounts()).toMatchObject({ total: 1 });
    expect(points).toMatchObject([
      {
        attributes: { provider: "gemini", model: "gemini-2.5-flash" },
        value: 10,
      },
    ]);
  });
});
