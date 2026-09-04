// Pure mapper: NDJSON agent-output envelopes (ADR-031 D8, #687) → pipeline.llm_calls cost rows, one per terminal `result` event; envelope ownership/unwrapping stays in lore-assembly-lines' agent-output (#875).

import { unwrapAttribution } from "@re-cinq/lore-assembly-lines";
import {
  parseCarriedRunIdentity,
  type CarriedRunIdentity,
} from "@re-cinq/lore-shared/project/run-identity/carried-run-identity.js";
import type {
  AgentRunEventInsert,
  AgentRunTurnInsert,
} from "@re-cinq/lore-shared";
import {
  rowsFromEnvelope,
  MAX_RUN_EVENTS_PER_BATCH,
} from "./agent-run-events.js";
import {
  turnFromEnvelope,
  MAX_RUN_TURNS_PER_BATCH,
} from "./agent-run-turns.js";
import { isRecord } from "@re-cinq/lore-shared/lib/is-record.js";
import { computeGeminiCost } from "@re-cinq/lore-shared/llm/gemini-provider.js";

export interface LlmCallRow {
  /** Always non-empty — rowFromEnvelope returns null for a taskId-less envelope. */
  taskId: string;
  /** `source.agent` (the Agent CR name), giving task-backed runs per-attempt cost (#947); null when unattributed. */
  agentCrName: string | null;
  /** The identity the producer stated, when it did — authoritative over the CR-name lookup (#1147). */
  carried: CarriedRunIdentity | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
}

const num = (value: unknown): number => (typeof value === "number" ? value : 0);

// Primary model: first key of `modelUsage` (Claude Code) or `stats.models` (Gemini, confirmed against a real CLI run), else flat `model`, else "unknown".
function firstModelKey(perModelUsage: unknown): string | null {
  if (!isRecord(perModelUsage)) {
    return null;
  }
  const keys = Object.keys(perModelUsage);

  return keys.length > 0 ? keys[0] : null;
}

function resultModel(ev: Record<string, unknown>): string {
  const fromModelUsage = firstModelKey(ev.modelUsage);

  if (fromModelUsage !== null) {
    return fromModelUsage;
  }
  const fromStats = isRecord(ev.stats) ? firstModelKey(ev.stats.models) : null;

  if (fromStats !== null) {
    return fromStats;
  }

  return typeof ev.model === "string" ? ev.model : "unknown";
}

interface ResultTokens {
  inputTokens: number;
  outputTokens: number;
}

// Claude Code/Codex carry cumulative usage under `usage`, Gemini under `stats`; null (not zero-filled) when neither is present so the line stays skipped.
function resultTokens(ev: Record<string, unknown>): ResultTokens | null {
  if (isRecord(ev.usage)) {
    return {
      inputTokens: num(ev.usage.input_tokens),
      outputTokens: num(ev.usage.output_tokens),
    };
  }

  if (isRecord(ev.stats)) {
    return {
      inputTokens: num(ev.stats.input_tokens),
      outputTokens: num(ev.stats.output_tokens),
    };
  }

  return null;
}

// Claude Code/Codex report `duration_ms` at the top level; Gemini reports it under `stats`.
function resultDurationMs(ev: Record<string, unknown>): number {
  if (typeof ev.duration_ms === "number") {
    return ev.duration_ms;
  }

  return isRecord(ev.stats) ? num(ev.stats.duration_ms) : 0;
}

// Gemini reports no `total_cost_usd` (quota-based billing) so we price it from tokens; keyed on the "gemini-" model prefix since the envelope carries no vendor field.
function resultCostUsd(
  ev: Record<string, unknown>,
  model: string,
  tokens: ResultTokens,
): number {
  if (typeof ev.total_cost_usd === "number") {
    return ev.total_cost_usd;
  }

  return model.startsWith("gemini-")
    ? computeGeminiCost(model, tokens.inputTokens, tokens.outputTokens)
    : 0;
}

function rowFromEnvelope(envelope: unknown): LlmCallRow | null {
  const { source, event: ev } = unwrapAttribution(envelope);
  const taskId = typeof source?.task === "string" ? source.task : "";

  if (!taskId) {
    return null;
  }

  if (!isRecord(ev) || ev.type !== "result") {
    return null;
  }

  const tokens = resultTokens(ev);

  if (!tokens) {
    return null;
  }

  const model = resultModel(ev);

  return {
    taskId,
    agentCrName: typeof source?.agent === "string" ? source.agent : null,
    carried: parseCarriedRunIdentity(source),
    model,
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
    costUsd: resultCostUsd(ev, model, tokens),
    durationMs: resultDurationMs(ev),
  };
}

/** A file declared under `output.watch`, raised by the subsystem on agent exit (`{"kind":"file"}`); `content`/`reason` are mutually exclusive — an undelivered declared artifact still reports, carrying why. */
export interface AgentFileEvent {
  taskId: string;
  agentCrName: string | null;
  /** The recipe-declared event name, so one run can raise several artifacts. */
  event: string;
  path: string;
  content: string | null;
  reason: string | null;
}

const str = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

/** Project a `kind:"file"` envelope; null for any other line, a nameless artifact, or one with no task attribution (skip-don't-throw, same rule the cost projection uses). */
function fileEventFromEnvelope(envelope: unknown): AgentFileEvent | null {
  const { source, event: ev } = unwrapAttribution(envelope);
  const taskId = typeof source?.task === "string" ? source.task : "";

  if (!taskId || !isRecord(ev) || ev.kind !== "file") {
    return null;
  }
  const event = str(ev.event);

  if (!event) {
    return null;
  }

  return {
    taskId,
    agentCrName: typeof source?.agent === "string" ? source.agent : null,
    event,
    path: str(ev.path) ?? "",
    content: str(ev.content),
    reason: str(ev.reason),
  };
}

export interface AgentSink {
  costRows: LlmCallRow[];
  runEvents: AgentRunEventInsert[];
  fileEvents: AgentFileEvent[];
  /** Full-fidelity turns, empty unless `collectTurns` (specs/turn-level-transcript-store). */
  turns: AgentRunTurnInsert[];
  /** Turns lost to unparseable (redacted) lines — counted, not swallowed, so losses stay visible. */
  turnsDropped: number;
  /** Turns lost to MAX_RUN_TURNS_PER_BATCH — counted so "the transcript is complete" is a supportable claim. */
  turnsCapped: number;
}

/** Yield each `\n`-delimited line without `split`'s second-copy allocation — the difference that lets a 25MB report parse under 512Mi. */
function* lines(body: string): Generator<string> {
  let start = 0;

  for (let i = 0; i < body.length; i++) {
    if (body.charCodeAt(i) === 10) {
      yield body.slice(start, i);
      start = i + 1;
    }
  }

  if (start < body.length) {
    yield body.slice(start);
  }
}

function ingestCostAndFileRows(sink: AgentSink, envelope: unknown): void {
  const costRow = rowFromEnvelope(envelope);

  if (costRow) {
    sink.costRows.push(costRow);
  }
  const fileEvent = fileEventFromEnvelope(envelope);

  if (fileEvent) {
    sink.fileEvents.push(fileEvent);
  }
}

function ingestTurn(
  sink: AgentSink,
  envelope: unknown,
  line: string,
  collectTurns: boolean,
): void {
  if (!collectTurns) {
    return;
  }

  if (sink.turns.length >= MAX_RUN_TURNS_PER_BATCH) {
    sink.turnsCapped++;

    return;
  }
  const turn = turnFromEnvelope(envelope, line);

  if (turn === null) {
    sink.turnsDropped++;

    return;
  }
  sink.turns.push(turn);
}

function ingestRunEvents(
  sink: AgentSink,
  envelope: unknown,
  projectRunEvents: boolean,
): void {
  if (!projectRunEvents || sink.runEvents.length >= MAX_RUN_EVENTS_PER_BATCH) {
    return;
  }
  collectRunEventsUpToCap(sink.runEvents, envelope);
}

function parseEnvelopeLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

/** Parse the NDJSON sink body ONCE into cost rows + (optionally) run-visualization rows + (optionally) full-fidelity turns; single-pass parsing bounds peak memory (the regression that OOM-looped the single Floor replica). Blank/unparseable lines are skipped; a task-less line still collects as a turn. Nothing throws. */
export function parseAgentSink(
  ndjson: string,
  projectRunEvents = true,
  collectTurns = true,
): AgentSink {
  const sink: AgentSink = {
    costRows: [],
    runEvents: [],
    fileEvents: [],
    turns: [],
    turnsDropped: 0,
    turnsCapped: 0,
  };

  for (const line of lines(ndjson)) {
    if (!line.trim()) {
      continue;
    }
    const envelope = parseEnvelopeLine(line);

    if (envelope === undefined) {
      continue;
    }

    ingestCostAndFileRows(sink, envelope);
    ingestTurn(sink, envelope, line, collectTurns);
    ingestRunEvents(sink, envelope, projectRunEvents);
  }

  return sink;
}

function collectRunEventsUpToCap(
  runEvents: AgentRunEventInsert[],
  envelope: unknown,
): void {
  for (const runEvent of rowsFromEnvelope(envelope)) {
    if (runEvents.length >= MAX_RUN_EVENTS_PER_BATCH) {
      return;
    }
    runEvents.push(runEvent);
  }
}

/** The cost projection alone (skips blank, unparseable, non-`result`, and taskId-less lines). */
export function parseAgentEvents(ndjson: string): LlmCallRow[] {
  return parseAgentSink(ndjson, false, false).costRows;
}
