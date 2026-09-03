// The single source of truth for the station contract's output envelope
// (ADR-031 D8/D9): the wrap side every station emits through and the unwrap
// side every Floor reader consumes through. An Agent's `status.output` is an
// NDJSON event stream whose terminal line is the claude-style
// `{"type":"result","is_error":false,"result":"<agent text>"}`.
//
// The agent text rides inside a JSON string field, so its newlines arrive
// escaped and any fenced block or embedded JSON is backslash-escaped with it.
// Unwrap here, once, at the read boundary — then the text parsers
// (parseNodeResult / parseReviewVerdict / parseReviewFindings) stay pure and
// see the agent text exactly as the agent printed it. Parsers that scan for a
// single-line marker survive the escaping by luck; anything needing a real
// newline (the ```REVIEW_FINDINGS block) does not.

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { NodeResult, NodeLlmUsage } from "./node-types.js";

interface ResultLine {
  type: string;
  result?: unknown;
  is_error?: unknown;
}

/** A gemini-style assistant chunk: the CLI streams the message as delta
 *  fragments and its terminal result line carries stats only — no text. */
interface MessageLine {
  type: string;
  role?: unknown;
  content?: unknown;
}

// TRANSITIONAL (delete once no pre-cutover CRs remain): before the
// ai-agent-subsystem stopped stamping its {"source": {...}, "event": <line>}
// attribution envelope onto stdout, every status.output line arrived wrapped
// one level deeper. Peel that layer so those CRs' results still parse.
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

/**
 * The final assistant message, reassembled from the delta chunks that
 * immediately precede the result line. Walks backwards and stops at the first
 * line that is not an assistant chunk: earlier turns are separated by tool
 * events, and including them would let a marker MENTIONED mid-run (an agent
 * thinking aloud about the REVIEW_FINDINGS block it is about to write) shadow
 * the block it actually wrote. Chunks concatenate with no separator — they are
 * fragments of one text, not lines.
 */
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

/**
 * The attribution envelope peeled off a subsystem line: the event it carries and
 * the source that attributes it (null when the line is bare, or its source is
 * not an object). The unwrap side of the envelope for both lanes — the
 * `status.output` read path and the NDJSON telemetry sink (POST /api/agent-events).
 */
export function unwrapAttribution(value: unknown): {
  source: Record<string, unknown> | null;
  event: unknown;
} {
  if (!isAttributedLine(value)) {
    return { source: null, event: value };
  }

  const source = attributionSource(value.source);
  const event = value.event;

  // TRANSITIONAL — the second peel only. Prod emits double-wrapped lines
  // ({source, event: {source, event}}) on the sink lane, so the terminal result
  // sits at .event.event and its cost row is dropped without it (#875).
  // Deletion condition: remove once the ai-agent-subsystem wrapper enforces
  // single-wrap at the source for the sink lane. subsystem#171 claims stdout
  // already does — unverifiable from this repo, and it cannot be the whole story
  // while nested lines still arrive, so the nesting either predates that guard
  // or reaches the sink by another path. Confirm which before deleting.
  // Deliberately bounded at two: a third layer is left intact as the event
  // rather than peeled by a loop.
  if (isAttributedLine(event)) {
    const inner = attributionSource(event.source);

    return {
      source: source || inner ? { ...inner, ...source } : null,
      event: event.event,
    };
  }

  return { source, event };
}

/**
 * The agent text carried by the last terminal result line of an NDJSON stream.
 * Falls back to the raw input when the output is not an NDJSON stream, carries
 * no result line, or the result line has no string payload — legacy and
 * already-unwrapped output must pass through untouched.
 */
export function resultTextFromOutput(output: string): string {
  const lines = output.split("\n");

  for (let i = lines.length - 1; i >= 0; i--) {
    const parsed = parseLine(lines[i].trim());

    if (parsed && typeof parsed.result === "string") {
      return parsed.result;
    }

    // A result line with NO text payload is the gemini shape: its stream-json
    // terminal line carries stats only, and the agent's final text arrives as
    // assistant delta chunks just before it. Reassemble those — otherwise the
    // fallback hands the parsers raw NDJSON, where a fenced block's newlines
    // are escaped inside a JSON string and can never match (run 6cb4b352,
    // 2026-09-02: verdict seen, findings lost, review failed).
    if (parsed) {
      return trailingAssistantText(lines, i) ?? output;
    }
  }

  return output;
}

/**
 * The error text of the last `is_error` result line in an NDJSON stream (the
 * same envelope `resultTextFromOutput` reads, both bare and `{source,event}`
 * wrapped), capped at 300 chars. Null when the terminal result is not an error,
 * there is no result line, or the output is not a stream. This is how the Floor
 * surfaces WHY a CR's Job failed — the infra-failure branch only sees the CR
 * phase, not the message the agent printed before it died.
 */
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

/** The runner's relay prefix for the engine's own stderr. */
const AGENT_STDERR_PREFIX = "[agent] ";

/** The lifecycle phase the relayed stderr belongs to. */
const AGENT_PHASE = "agent";

/**
 * True for a lifecycle envelope reporting the AGENT phase as failed.
 *
 * Parsed here rather than through `parseLine`, which answers only for RESULT
 * shapes and so discards a lifecycle envelope entirely.
 *
 * A phase this marker NAMES must be the agent's: an init-phase death has its
 * own markers, and attributing the engine's stderr to it would put the wrong
 * cause on the run. A marker naming NO phase still counts — `phase` is optional
 * on the shape, and demanding it would let the very defect this exists for
 * survive in a phase-less variant.
 */
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

/** The parsed value as a FAILED lifecycle marker, or null for anything else. */
function failedLifecycleMarker(value: unknown): { phase?: unknown } | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const marker = value as { kind?: unknown; status?: unknown; phase?: unknown };
  const isFailedMarker =
    marker.kind === "lifecycle" && marker.status === "failed";

  return isFailedMarker ? marker : null;
}

/**
 * The agent's own last words when it never reached a result line.
 *
 * `terminalErrorText` reads claude's terminal `is_error` result line, which is
 * the richest statement of a failure — and does not exist when the engine dies
 * at BOOT. The pod still says what happened, on the other stream: the runner
 * relays the engine's stderr as `[agent] …` between lifecycle envelopes. Run
 * 129235d4 (2026-08-28) printed exactly one such line —
 * `Error: Settings file not found: /agent/.claude/settings.json` — and because
 * nothing read it, the classifier fell through to Kubernetes' `BackoffLimit-
 * Exceeded`, called a permanent misconfiguration retryable `infra`, and spent a
 * 25-minute implement retry on a fault no retry could clear.
 *
 * Two gates keep this from reading ordinary chatter as a cause: the line must
 * carry the runner's own prefix (model prose and tool results are JSON on their
 * own lines and never prefixed), and the run must carry a lifecycle envelope
 * reporting the agent phase FAILED. Bounded like its sibling — this text rides
 * a CR status and a notification.
 */
export function agentStderrError(output?: string): string | null {
  if (!output) {
    return null;
  }
  const lines = output.split("\n").map((line) => line.trim());
  // The scan is BOUNDED by the failure, not by the end of the stream: a line
  // the runner logs while shutting down is not what killed the engine.
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

/** True when `text` is already a serialized result line or attribution envelope. */
function isWrappedAgentOutput(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text);

    return isResultLine(value) || isAttributedLine(value);
  } catch {
    return false;
  }
}

/**
 * The terminal NDJSON line a station emits. A NodeResult (including outcome
 * "failed" — a normal result that routes the failed edge) emits
 * `is_error:false`; pass `null` + an error message for infrastructure
 * failures, which fail the CR itself. `usage` wins over `result.usage` and
 * also rides error lines, so a failed run's partial spend is still recorded.
 */
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

/** Progress lines for the log sinks (anything non-terminal). */
export function eventLine(message: string): string {
  return JSON.stringify({ type: "log", message });
}

/**
 * Reported node LLM usage as the claude-style fields the `/api/agent-events`
 * cost sink reads off a terminal result event (`usage` + `total_cost_usd` +
 * `duration_ms` + `model`) — how a Postgres-less station pod gets a
 * `pipeline.llm_calls` row. Empty when the node reported no usage, keeping
 * usage-less terminal lines byte-identical to the pre-usage envelope.
 */
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
