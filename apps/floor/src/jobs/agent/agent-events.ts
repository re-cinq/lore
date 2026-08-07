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

export interface LlmCallRow {
  /** Always non-empty — rowFromEnvelope returns null when the envelope carries
   *  no task id, so a row never reaches the sink with a blank taskId. */
  taskId: string;
  /** `source.agent` (the Agent CR name) — resolves to the exact assembly-line
   *  attempt at ingest, giving task-backed runs per-attempt cost (#947). Null
   *  when the pod sent no agent attribution. */
  agentCrName: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
}

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null;

const num = (x: unknown): number => (typeof x === "number" ? x : 0);

// Multi-model runs carry per-model usage under `modelUsage`; its first key is the
// primary model. Fall back to a flat `model`, then to "unknown".
function resultModel(ev: Record<string, unknown>): string {
  const modelUsage = ev.modelUsage;

  if (isObject(modelUsage)) {
    const keys = Object.keys(modelUsage);

    if (keys.length > 0) {
      return keys[0];
    }
  }

  return typeof ev.model === "string" ? ev.model : "unknown";
}

function rowFromEnvelope(envelope: unknown): LlmCallRow | null {
  const { source, event: ev } = unwrapAttribution(envelope);
  const taskId = typeof source?.task === "string" ? source.task : "";

  if (!taskId) {
    return null;
  }

  if (!isObject(ev) || ev.type !== "result" || !isObject(ev.usage)) {
    return null;
  }

  return {
    taskId,
    agentCrName: typeof source?.agent === "string" ? source.agent : null,
    model: resultModel(ev),
    inputTokens: num(ev.usage.input_tokens),
    outputTokens: num(ev.usage.output_tokens),
    costUsd: num(ev.total_cost_usd),
    durationMs: num(ev.duration_ms),
  };
}

export interface AgentSink {
  costRows: LlmCallRow[];
  runEvents: AgentRunEventInsert[];
  /** Full-fidelity turns, empty unless `collectTurns` (specs/turn-level-transcript-store). */
  turns: AgentRunTurnInsert[];
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
 * `collectTurns` defaults off, matching its feature flag. Blank, unparseable and
 * task-less lines are skipped; nothing throws.
 */
export function parseAgentSink(
  ndjson: string,
  projectRunEvents = true,
  collectTurns = false,
): AgentSink {
  const costRows: LlmCallRow[] = [];
  const runEvents: AgentRunEventInsert[] = [];
  const turns: AgentRunTurnInsert[] = [];

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

    if (collectTurns && turns.length < MAX_RUN_TURNS_PER_BATCH) {
      const turn = turnFromEnvelope(envelope, line);

      if (turn) {
        turns.push(turn);
      }
    }

    if (!projectRunEvents || runEvents.length >= MAX_RUN_EVENTS_PER_BATCH) {
      continue;
    }

    for (const runEvent of rowsFromEnvelope(envelope)) {
      if (runEvents.length >= MAX_RUN_EVENTS_PER_BATCH) {
        break;
      }
      runEvents.push(runEvent);
    }
  }

  return { costRows, runEvents, turns };
}

/** The cost projection alone (skips blank, unparseable, and non-`result` lines,
 *  and lines with no resolvable task id). */
export function parseAgentEvents(ndjson: string): LlmCallRow[] {
  return parseAgentSink(ndjson, false).costRows;
}

/** GCS object key for an archived raw NDJSON sink batch (#687). Partitioned by UTC
 *  date for lifecycle rules; the full received instant keeps same-second batches
 *  distinct, and the first task id tags the object for eyeballing. */
export function agentEventsArchiveKey(
  receivedAtIso: string,
  taskIds: readonly string[],
): string {
  const date = receivedAtIso.slice(0, 10);
  const instant = receivedAtIso.replace(/[:.]/g, "-");
  const tag = taskIds.length > 0 ? taskIds[0] : "unknown";

  return `__agent_events__/${date}/${instant}-${tag}.ndjson`;
}
