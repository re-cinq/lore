import { describe, expect, it } from "vitest";
import { metrics } from "@opentelemetry/api";
import {
  InMemoryMetricExporter,
  AggregationTemporality,
  MeterProvider,
  PeriodicExportingMetricReader,
  type DataPoint,
  type ResourceMetrics,
} from "@opentelemetry/sdk-metrics";
import {
  recordBusDelivery,
  recordFloorStart,
  recordLlmCall,
  recordStationRun,
  recordToolCall,
  recordWebhookEvent,
  traceHttp,
} from "./metrics.js";

const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
const reader = new PeriodicExportingMetricReader({
  exporter,
  exportIntervalMillis: 60_000,
});
const provider = new MeterProvider({ readers: [reader] });

metrics.setGlobalMeterProvider(provider);

async function collected(): Promise<ResourceMetrics> {
  const { resourceMetrics } = await reader.collect();

  return resourceMetrics;
}

function points(name: string, all: ResourceMetrics): DataPoint<unknown>[] {
  return all.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .filter((metric) => metric.descriptor.name === name)
    .flatMap((metric) => metric.dataPoints as DataPoint<unknown>[]);
}

describe("lore metrics", () => {
  it("counts a failed lore_search_context tool call as one call and one error", async () => {
    recordToolCall({
      tool: "lore_search_context",
      durationMs: 40,
      success: false,
    });

    const all = await collected();
    const [call] = points("lore.tool.calls", all);
    const [error] = points("lore.tool.errors", all);

    expect(call).toMatchObject({
      attributes: { tool: "lore_search_context", success: "false" },
      value: 1,
    });
    expect(error).toMatchObject({
      attributes: { tool: "lore_search_context" },
      value: 1,
    });
  });

  it("counts a station run of pr-ready-check as success and records its duration", async () => {
    recordStationRun({
      station: "pr-ready-check",
      outcome: "success",
      durationMs: 120,
    });

    const all = await collected();
    const [run] = points("lore.station.runs", all);
    const [duration] = points("lore.station.duration_ms", all);

    expect(run).toMatchObject({
      attributes: { station: "pr-ready-check", outcome: "success" },
      value: 1,
    });
    expect(duration?.attributes).toEqual({
      station: "pr-ready-check",
      outcome: "success",
    });
  });

  it("counts a dead bus delivery of github.pull_request.opened", async () => {
    recordBusDelivery("github.pull_request.opened", "dead");

    const [point] = points("lore.bus.deliveries", await collected());

    expect(point).toMatchObject({
      attributes: { event_name: "github.pull_request.opened", result: "dead" },
      value: 1,
    });
  });

  it("counts a joined code-review start", async () => {
    recordFloorStart("code-review", { joined: true });

    const [point] = points("lore.floor.starts", await collected());

    expect(point).toMatchObject({
      attributes: { line: "code-review", joined: "true" },
      value: 1,
    });
  });

  it("counts a github.push webhook event", async () => {
    recordWebhookEvent("github.push");

    const [point] = points("lore.webhook.events", await collected());

    expect(point).toMatchObject({
      attributes: { event: "github.push" },
      value: 1,
    });
  });

  it("records a claude-sonnet call as 1 call, 300 input, 50 output tokens and 0.02 usd", async () => {
    recordLlmCall({
      model: "claude-sonnet-4-5",
      inputTokens: 300,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0.02,
      status: "success",
    });

    const all = await collected();
    const call = points("lore.llm.calls", all).find(
      (point) => point.attributes.model === "claude-sonnet-4-5",
    );
    const tokens = points("lore.llm.tokens", all).filter(
      (point) => point.attributes.model === "claude-sonnet-4-5",
    );
    const [cost] = points("lore.llm.cost_usd", all);

    expect(call).toMatchObject({
      attributes: {
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        status: "success",
      },
      value: 1,
    });
    expect(tokens.map((point) => [point.attributes.kind, point.value])).toEqual(
      [
        ["input", 300],
        ["output", 50],
        ["cache_read", 0],
        ["cache_write", 0],
      ],
    );
    expect(cost).toMatchObject({
      attributes: { provider: "anthropic", model: "claude-sonnet-4-5" },
      value: 0.02,
    });
  });

  it("records GET /api/repos/<uuid>/x as GET /api/repos with status 200", async () => {
    traceHttp(
      "GET",
      "/api/repos/0d2b1f8e-1111-2222-3333-444455556666/x?y=1",
      200,
      12,
    );

    const [point] = points("lore.http.requests", await collected());

    expect(point).toMatchObject({
      attributes: { method: "GET", path: "/api/repos", status: "200" },
      value: 1,
    });
  });
});
