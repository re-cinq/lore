// Agent telemetry sink (ADR-031 D8, #687): the ai-agent-subsystem POSTs its run output
// as NDJSON to the Floor — one envelope per line, `{"source":{...,"task":<TASK_ID>},
// "event":<the claude/codex stream-json line>}`. This pure mapper turns those lines into
// pipeline.llm_calls rows for cost accounting: one row per run, taken from the terminal
// `result` event (it carries total_cost_usd + the run's cumulative usage + duration). The
// HTTP receipt + DB insert is the IO shell (delivery/http/routes/agent-events.ts).
//
// The envelope itself is owned by @re-cinq/lore-assembly-lines' agent-output —
// this mapper consumes unwrapAttribution and peels nothing of its own (#875).

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
  /** Always non-empty — rowFromEnvelope returns null when the envelope carries
   *  no task id, so a row never reaches the sink with a blank taskId. */
  taskId: string;
  /** `source.agent` (the Agent CR name) — resolves to the exact assembly-line
   *  attempt at ingest, giving task-backed runs per-attempt cost (#947). Null
   *  when the pod sent no agent attribution. */
  agentCrName: string | null;
  /** The identity the producer STATED, when it did (#1147) — authoritative over
   *  the CR-name lookup. Null from a producer that stamps none. */
  carried: CarriedRunIdentity | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
}

const num = (x: unknown): number => (typeof x === "number" ? x : 0);

// Multi-model runs carry per-model usage under `modelUsage` (Claude Code); its
// first key is the primary model. A Gemini run's `stats.models` is the same
// idea under a different key (confirmed against a real `gemini` CLI run — its
// stream-json result has no `modelUsage`/`usage`, only `stats`). Fall back to
// a flat `model`, then to "unknown".
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

// Claude Code (and Codex) carry cumulative usage under `usage`; a `gemini` CLI
// run instead carries it under `stats` — same fields, different parent key.
// Null (not zero-filled) when neither is present, so a line missing usage
// entirely stays skipped exactly as it always has.
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

// Claude Code's/Codex's terminal event reports `duration_ms` at the top
// level; a `gemini` CLI run reports it under `stats` instead.
function resultDurationMs(ev: Record<string, unknown>): number {
  if (typeof ev.duration_ms === "number") {
    return ev.duration_ms;
  }

  return isRecord(ev.stats) ? num(ev.stats.duration_ms) : 0;
}

// Claude Code and Codex self-report `total_cost_usd` on the terminal event;
// Gemini's CLI does not (its billing is quota-based, not always a $ figure) —
// price it ourselves from the reported tokens instead of defaulting to zero.
// Model-string-keyed rather than vendor-keyed, since the envelope carries no
// vendor field — safe because Anthropic/OpenAI model ids never collide with
// the "gemini-" prefix.
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

/** A file the run declared under `output.watch` and the subsystem raised once the
 *  agent exited (`{"kind":"file"}`). The delivery channel for an agent whose
 *  deliverable is an artifact rather than its prose — see the subsystem's
 *  notification-api reference. `content` and `reason` are mutually exclusive: a
 *  declared artifact the agent never produced still reports, carrying why. */
export interface AgentFileEvent {
  taskId: string;
  agentCrName: string | null;
  /** The recipe-declared event name, so one run can raise several artifacts. */
  event: string;
  path: string;
  content: string | null;
  reason: string | null;
}

const str = (x: unknown): string | null => (typeof x === "string" ? x : null);

/** Project a `kind:"file"` envelope. Null for every other line, for an artifact
 *  with no name (nothing could route it) and for one with no task attribution
 *  (nothing to act on) — the same skip-don't-throw rule the cost projection uses. */
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
  /** Turns lost because redaction left their line unparseable. Reported rather
   *  than swallowed: a store justified by fidelity must make its own losses
   *  visible, and an agent can trigger the drop on purpose. */
  turnsDropped: number;
  /** Turns lost to MAX_RUN_TURNS_PER_BATCH. The other half of the same
   *  property: every path that loses a turn is counted, so "the transcript is
   *  complete" is a claim the metrics can actually support. */
  turnsCapped: number;
}

/** Yield each `\n`-delimited line without materializing the whole array.
 *  `String.prototype.split` on a multi-MB body allocates a second copy of it in
 *  line strings; iterating with sliced substrings keeps peak memory at ~one copy
 *  of the body — the difference that lets a 25MB report parse under 512Mi. */
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

/**
 * Parse the Agent NDJSON sink body ONCE into the per-run llm_calls cost rows;
 * when `projectRunEvents`, the per-tool-call run-visualization rows (capped at
 * MAX_RUN_EVENTS_PER_BATCH); and when `collectTurns`, the full-fidelity turn
 * rows (capped at MAX_RUN_TURNS_PER_BATCH). Parsing each line a single time
 * rather than once per projection, and streaming the split rather than arraying
 * it, bound the peak memory a large body holds — the regression that OOM-looped
 * the single Floor replica. Turn collection reuses that same parse and the line
 * string the scanner already yielded, so it adds no parse and no serialization;
 * `collectTurns` is on by default — turn collection is unconditional in
 * production, with no feature flag. The argument exists so the cost-only path
 * can opt out, and so tests can assert that collecting turns perturbs neither
 * the cost rows nor the projection.
 *
 * Blank and unparseable lines are skipped. A task-less line yields no cost row
 * and no visualization row, but IS still collected as a turn — the turn store
 * keeps what it cannot label. The only turn loss is a line whose redaction left
 * it unparseable (`turnsDropped`) or one the per-batch cap left out
 * (`turnsCapped`) — both counted rather than swallowed, so every lost turn is
 * visible. Nothing throws.
 */
export function parseAgentSink(
  ndjson: string,
  projectRunEvents = true,
  collectTurns = true,
): AgentSink {
  const costRows: LlmCallRow[] = [];
  const runEvents: AgentRunEventInsert[] = [];
  const fileEvents: AgentFileEvent[] = [];
  const turns: AgentRunTurnInsert[] = [];
  let turnsDropped = 0;
  let turnsCapped = 0;

  for (const line of lines(ndjson)) {
    if (!line.trim()) {
      continue;
    }
    let envelope: unknown;

    try {
      envelope = JSON.parse(line);
    } catch {
      continue;
    }
    const costRow = rowFromEnvelope(envelope);

    if (costRow) {
      costRows.push(costRow);
    }
    const fileEvent = fileEventFromEnvelope(envelope);

    if (fileEvent) {
      fileEvents.push(fileEvent);
    }

    const wantTurn = collectTurns && turns.length < MAX_RUN_TURNS_PER_BATCH;

    if (collectTurns && !wantTurn) {
      turnsCapped++;
    }
    const turn = wantTurn ? turnFromEnvelope(envelope, line) : null;

    if (wantTurn && turn === null) {
      turnsDropped++;
    }

    if (turn) {
      turns.push(turn);
    }

    if (!projectRunEvents || runEvents.length >= MAX_RUN_EVENTS_PER_BATCH) {
      continue;
    }
    collectRunEventsUpToCap(runEvents, envelope);
  }

  return { costRows, runEvents, fileEvents, turns, turnsDropped, turnsCapped };
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

/** The cost projection alone (skips blank, unparseable, and non-`result` lines,
 *  and lines with no resolvable task id). */
export function parseAgentEvents(ndjson: string): LlmCallRow[] {
  return parseAgentSink(ndjson, false, false).costRows;
}
