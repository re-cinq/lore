// Single source of truth for the station contract's output envelope (ADR-031 D8/D9) — wrap side every station emits through, unwrap side every Floor reader consumes through; `status.output` is NDJSON, terminal line `{"type":"result","is_error":false,"result":"<agent text>"}`.

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { NodeResult, NodeLlmUsage } from "./node-types.js";

interface ResultLine {
  type: string;
  result?: unknown;
  is_error?: unknown;
}

// Gemini-style assistant chunk: the CLI streams delta fragments, and the terminal result line carries stats only — no text.
interface MessageLine {
  type: string;
  role?: unknown;
  content?: unknown;
}

// TRANSITIONAL (delete once no pre-cutover CRs remain): peels the {"source":{...},"event":<line>} envelope pre-cutover CRs still wrap status.output in.
interface AttributedLine {
  source: unknown;
  event: unknown;
}

function parseLine(line: string): ResultLine | null {
  try {
    const value: unknown = JSON.parse(line);

    if (isResultLine(value)) {
      return value;
    }

    if (isAttributedLine(value) && isResultLine(value.event)) {
      return value.event;
    }

    return null;
  } catch {
    return null;
  }
}

function isResultLine(value: unknown): value is ResultLine {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as ResultLine).type === "result"
  );
}

function isAssistantChunk(value: unknown): value is MessageLine {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const msg = value as MessageLine;

  return msg.type === "message" && msg.role === "assistant";
}

function parseAssistantLine(line: string): string | null {
  try {
    let value: unknown = JSON.parse(line);

    if (isAttributedLine(value)) {
      value = value.event;
    }

    if (!isAssistantChunk(value)) {
      return null;
    }

    return typeof value.content === "string" ? value.content : null;
  } catch {
    return null;
  }
}

// Final assistant message, reassembled from delta chunks immediately preceding the result line; stops at the first non-chunk line so a marker mentioned mid-run can't shadow the block actually written, and chunks concatenate with no separator (fragments of one text).
function trailingAssistantText(
  lines: readonly string[],
  resultIndex: number,
): string | null {
  const chunks: string[] = [];

  for (let i = resultIndex - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();

    if (trimmed.length === 0) {
      continue;
    }
    const content = parseAssistantLine(trimmed);

    if (content === null) {
      break;
    }
    chunks.unshift(content);
  }

  return chunks.length > 0 ? chunks.join("") : null;
}

function isAttributedLine(value: unknown): value is AttributedLine {
  return (
    typeof value === "object" &&
    value !== null &&
    "source" in value &&
    "event" in value
  );
}

function attributionSource(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

// Attribution envelope peeled off a subsystem line (event + source, null source when bare/non-object) — unwrap side for both the status.output read path and the NDJSON telemetry sink (POST /api/agent-events).
export function unwrapAttribution(value: unknown): {
  source: Record<string, unknown> | null;
  event: unknown;
} {
  if (!isAttributedLine(value)) {
    return { source: null, event: value };
  }

  const source = attributionSource(value.source);
  const event = value.event;

  // TRANSITIONAL, second peel only: prod double-wraps sink-lane lines ({source, event:{source, event}}), dropping the cost row without this (#875); remove once subsystem enforces single-wrap at source (subsystem#171 unverified) — bounded at two, a third layer is left intact.
  if (isAttributedLine(event)) {
    const inner = attributionSource(event.source);

    return {
      source: source || inner ? { ...inner, ...source } : null,
      event: event.event,
    };
  }

  return { source, event };
}

// Agent text from the last terminal result line of an NDJSON stream; falls back to raw input when not a stream, no result line, or no string payload — legacy/already-unwrapped output passes through untouched.
export function resultTextFromOutput(output: string): string {
  const lines = output.split("\n");

  for (let i = lines.length - 1; i >= 0; i--) {
    const parsed = parseLine(lines[i].trim());

    if (parsed && typeof parsed.result === "string") {
      return parsed.result;
    }

    // A result line with no text payload is the gemini shape (stats-only terminal line, text arrives as preceding delta chunks) — reassemble those or the fallback hands parsers raw escaped NDJSON (run 6cb4b352, 2026-09-02: verdict seen, findings lost).
    if (parsed) {
      return trailingAssistantText(lines, i) ?? output;
    }
  }

  return output;
}

// Error text of the last `is_error` result line (same envelope as resultTextFromOutput), capped at 300 chars, null when not an error/no result line/not a stream — how the Floor surfaces WHY a CR's Job failed, since the infra-failure branch only sees the CR phase.
export function terminalErrorText(output?: string): string | null {
  if (!output) {
    return null;
  }
  const lines = output.split("\n");

  for (let i = lines.length - 1; i >= 0; i--) {
    const parsed = parseLine(lines[i].trim());

    if (
      parsed &&
      parsed.is_error === true &&
      typeof parsed.result === "string"
    ) {
      return parsed.result.substring(0, 300);
    }
  }

  return null;
}

// The runner's relay prefix for the engine's own stderr.
const AGENT_STDERR_PREFIX = "[agent] ";

// The lifecycle phase the relayed stderr belongs to.
const AGENT_PHASE = "agent";

// True for a lifecycle envelope reporting the AGENT phase failed; parsed separately from `parseLine` (RESULT-only) — a marker naming no phase (phase is optional) still counts, or a phase-less variant would escape detection.
function isFailedLifecycle(line: string): boolean {
  try {
    const marker = failedLifecycleMarker(JSON.parse(line));

    if (marker === null) {
      return false;
    }

    return marker.phase === undefined || marker.phase === AGENT_PHASE;
  } catch {
    return false;
  }
}

// The parsed value as a FAILED lifecycle marker, or null for anything else.
function failedLifecycleMarker(value: unknown): { phase?: unknown } | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const marker = value as { kind?: unknown; status?: unknown; phase?: unknown };
  const isFailedMarker =
    marker.kind === "lifecycle" && marker.status === "failed";

  return isFailedMarker ? marker : null;
}

// The agent's own last words when it never reached a result line (engine died at BOOT, before terminalErrorText's is_error line exists) — the runner relays engine stderr as `[agent] …`; run 129235d4 (2026-08-28) showed an unread boot error misclassified as retryable `infra`, burning a 25min retry. Gated on the runner's own prefix + a lifecycle envelope reporting agent phase FAILED, so ordinary chatter never reads as a cause.
export function agentStderrError(output?: string): string | null {
  if (!output) {
    return null;
  }
  const lines = output.split("\n").map((line) => line.trim());
  // Scan is bounded by the failure, not stream end — a shutdown log line is not what killed the engine.
  const failedAt = lines.findIndex(isFailedLifecycle);

  if (failedAt === -1) {
    return null;
  }

  for (let i = failedAt; i >= 0; i--) {
    if (!lines[i].startsWith(AGENT_STDERR_PREFIX)) {
      continue;
    }
    const text = lines[i].slice(AGENT_STDERR_PREFIX.length).trim();

    if (text.length > 0) {
      return text.substring(0, 300);
    }
  }

  return null;
}

// True when `text` is already a serialized result line or attribution envelope.
function isWrappedAgentOutput(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text);

    return isResultLine(value) || isAttributedLine(value);
  } catch {
    return false;
  }
}

// Terminal NDJSON line a station emits: a NodeResult (incl. outcome "failed", a routable edge) emits is_error:false; pass null + message for infra failures, which fail the CR. `usage` wins over `result.usage` and rides error lines too, so partial spend is still recorded.
export function resultLine(
  result: NodeResult | null,
  errorMessage?: string,
  usage?: NodeLlmUsage,
): string {
  const payload = result
    ? `LORE_NODE_RESULT: ${JSON.stringify({ outcome: result.outcome, extras: result.extras ?? {} })}`
    : (errorMessage ?? "station failed");

  enforceTrue(
    !isWrappedAgentOutput(payload),
    Error,
    "refusing to wrap an already-wrapped agent output line — the envelope is applied exactly once",
  );

  return JSON.stringify({
    type: "result",
    is_error: result === null,
    result: payload,
    ...usageFields(usage ?? result?.usage),
  });
}

// Progress lines for the log sinks (anything non-terminal).
export function eventLine(message: string): string {
  return JSON.stringify({ type: "log", message });
}

// Node LLM usage as the claude-style fields the /api/agent-events cost sink reads (usage + total_cost_usd + duration_ms + model) — how a Postgres-less station pod gets a pipeline.llm_calls row; empty when unreported, keeping the envelope byte-identical to pre-usage.
function usageFields(usage?: NodeLlmUsage): Record<string, unknown> {
  if (!usage) {
    return {};
  }

  return {
    model: usage.model,
    usage: {
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
    },
    total_cost_usd: usage.costUsd,
    duration_ms: usage.durationMs,
  };
}
