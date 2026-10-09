// Instruments are resolved against the CURRENT global provider on every record, never at import: the metrics API has no proxy meter, so one created before a provider registers is a no-op for good (ADR-050).

import { metrics, type Meter, type MeterProvider } from "@opentelemetry/api";
import { modelVendor } from "../llm/model-vendor.js";

const GAP_THRESHOLD = 0.72;

export function isGapCandidate(topScore: number): boolean {
  return topScore < GAP_THRESHOLD;
}

export function traceHttp(
  method: string,
  path: string,
  statusCode: number,
  durationMs: number,
): void {
  const route = normalizePath(path);
  const { httpLatency, httpRequests } = instruments();

  httpLatency.record(durationMs, { method, path: route });
  httpRequests.add(1, { method, path: route, status: String(statusCode) });
}

export interface ToolCallRecord {
  tool: string;
  durationMs: number;
  success: boolean;
}

export function recordToolCall(call: ToolCallRecord): void {
  const { toolLatency, toolCalls, toolErrors } = instruments();

  toolLatency.record(call.durationMs, { tool: call.tool });
  toolCalls.add(1, { tool: call.tool, success: String(call.success) });

  if (!call.success) {
    toolErrors.add(1, { tool: call.tool });
  }
}

export function recordRetrieval(namespace: string, topScore: number): void {
  const { retrievalScore, retrievals, gapCandidates } = instruments();

  retrievalScore.record(topScore, { namespace });
  retrievals.add(1, { namespace });

  if (isGapCandidate(topScore)) {
    gapCandidates.add(1, { namespace });
  }
}

export function recordTaskCreated(taskType: string, repo: string): void {
  instruments().tasksCreated.add(1, { task_type: taskType, repo });
}

export function recordEpisodeWritten(source: string): void {
  instruments().episodesWritten.add(1, { source });
}

export interface StationRunRecord {
  station: string;
  outcome: "success" | "error";
  durationMs: number;
}

export function recordStationRun(run: StationRunRecord): void {
  const attributes = { station: run.station, outcome: run.outcome };
  const { stationRuns, stationLatency } = instruments();

  stationRuns.add(1, attributes);
  stationLatency.record(run.durationMs, attributes);
}

export type BusDeliveryResult = "done" | "failed" | "dead";

export function recordBusDelivery(
  eventName: string,
  result: BusDeliveryResult,
): void {
  instruments().busDeliveries.add(1, { event_name: eventName, result });
}

/** Reads the depth on every scrape; a read that throws reports nothing for that scrape rather than a zero. */
export function observeBusQueueDepth(read: () => Promise<number>): void {
  instruments().busQueueDepth.addCallback(async (result) => {
    const depth = await read().catch(() => null);

    if (depth !== null) {
      result.observe(depth);
    }
  });
}

/** `joined` is the floor's answer: true when the start landed on a run already open for the same subject. */
export function recordFloorStart(
  line: string,
  started: { joined: boolean },
): void {
  instruments().floorStarts.add(1, { line, joined: String(started.joined) });
}

export function recordWebhookEvent(eventName: string): void {
  instruments().webhookEvents.add(1, { event: eventName });
}

export interface LlmCallMetric {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  status: "success" | "failed";
}

export function recordLlmCall(call: LlmCallMetric): void {
  const byModel = { provider: modelVendor(call.model), model: call.model };
  const { llmCalls, llmTokens, llmCost } = instruments();

  llmCalls.add(1, { ...byModel, status: call.status });
  llmTokens.add(call.inputTokens, { ...byModel, kind: "input" });
  llmTokens.add(call.outputTokens, { ...byModel, kind: "output" });
  llmTokens.add(call.cacheReadTokens, { ...byModel, kind: "cache_read" });
  llmTokens.add(call.cacheWriteTokens, { ...byModel, kind: "cache_write" });
  llmCost.add(call.costUsd, byModel);
}

type Instruments = ReturnType<typeof instrumentsOf>;

let cached: { provider: MeterProvider; instruments: Instruments } | null = null;

// Memoized per provider: the SDK hands back the same instrument for the same name, so a rebuild after a late registration costs one pass.
function instruments(): Instruments {
  const provider = metrics.getMeterProvider();

  if (cached?.provider !== provider) {
    cached = {
      provider,
      instruments: instrumentsOf(provider.getMeter("lore")),
    };
  }

  return cached.instruments;
}

function instrumentsOf(meter: Meter) {
  return {
    ...httpInstruments(meter),
    ...toolInstruments(meter),
    ...retrievalInstruments(meter),
    ...stationInstruments(meter),
    ...floorInstruments(meter),
    ...llmInstruments(meter),
  };
}

function httpInstruments(meter: Meter) {
  return {
    httpLatency: meter.createHistogram("lore.http.duration_ms", {
      description: "HTTP request duration in milliseconds",
      unit: "ms",
    }),
    httpRequests: meter.createCounter("lore.http.requests", {
      description: "Total HTTP requests",
    }),
  };
}

function toolInstruments(meter: Meter) {
  return {
    toolLatency: meter.createHistogram("lore.tool.duration_ms", {
      description: "MCP tool call duration in milliseconds",
      unit: "ms",
    }),
    toolCalls: meter.createCounter("lore.tool.calls", {
      description: "Total MCP tool calls",
    }),
    toolErrors: meter.createCounter("lore.tool.errors", {
      description: "MCP tool call errors",
    }),
  };
}

function retrievalInstruments(meter: Meter) {
  return {
    retrievalScore: meter.createHistogram("lore.retrieval.score", {
      description: "Top retrieval score per search call",
    }),
    retrievals: meter.createCounter("lore.retrieval.count", {
      description: "Total retrieval calls",
    }),
    gapCandidates: meter.createCounter("lore.retrieval.gap_candidates", {
      description: "Low-confidence retrievals (potential gaps)",
    }),
    tasksCreated: meter.createCounter("lore.tasks.created", {
      description: "Pipeline tasks created",
    }),
    episodesWritten: meter.createCounter("lore.episodes.written", {
      description: "Episodes written",
    }),
  };
}

function stationInstruments(meter: Meter) {
  return {
    stationRuns: meter.createCounter("lore.station.runs", {
      description: "Service station runs, by station and outcome",
    }),
    stationLatency: meter.createHistogram("lore.station.duration_ms", {
      description: "Service station run duration in milliseconds",
      unit: "ms",
    }),
    busDeliveries: meter.createCounter("lore.bus.deliveries", {
      description: "Bus deliveries this process finished, by event and result",
    }),
    busQueueDepth: meter.createObservableGauge("lore.bus.queue_depth", {
      description: "Deliveries waiting for this process's subscriber",
    }),
  };
}

function floorInstruments(meter: Meter) {
  return {
    floorStarts: meter.createCounter("lore.floor.starts", {
      description:
        "Runs Lore started on the floor, by line and whether it joined one already open",
    }),
    webhookEvents: meter.createCounter("lore.webhook.events", {
      description:
        "GitHub deliveries captured onto the bus, by the event they became",
    }),
  };
}

function llmInstruments(meter: Meter) {
  return {
    llmCalls: meter.createCounter("lore.llm.calls", {
      description:
        "Model calls Lore itself made, by provider, model and status",
    }),
    llmTokens: meter.createCounter("lore.llm.tokens", {
      description:
        "Tokens of Lore's own model calls, by provider, model and kind",
    }),
    llmCost: meter.createCounter("lore.llm.cost_usd", {
      description: "Computed cost of Lore's own model calls in USD",
      unit: "usd",
    }),
  };
}

// Collapses ids and drops the query so a route is one series, not one per id.
function normalizePath(path: string): string {
  return path
    .replace(/\/[0-9a-f-]{36}/g, "/:id")
    .replace(/\?.*/, "")
    .split("/")
    .slice(0, 3)
    .join("/");
}
