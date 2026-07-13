// Agent telemetry sink (ADR-031 D8, #687): the ai-agent-subsystem POSTs its run output
// as NDJSON to the Floor — one envelope per line, `{"source":{...,"task":<TASK_ID>},
// "event":<the claude/codex stream-json line>}`. This pure mapper turns those lines into
// pipeline.llm_calls rows for cost accounting: one row per run, taken from the terminal
// `result` event (it carries total_cost_usd + the run's cumulative usage + duration). The
// HTTP receipt + DB insert is the IO shell (delivery/http/routes/agent-events.ts).

export interface LlmCallRow {
  taskId: string;
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
  if (!isObject(envelope)) {
    return null;
  }
  const source = envelope.source;
  const taskId =
    isObject(source) && typeof source.task === "string" ? source.task : "";

  if (!taskId) {
    return null;
  }
  const ev = envelope.event;

  if (!isObject(ev) || ev.type !== "result" || !isObject(ev.usage)) {
    return null;
  }

  return {
    taskId,
    model: resultModel(ev),
    inputTokens: num(ev.usage.input_tokens),
    outputTokens: num(ev.usage.output_tokens),
    costUsd: num(ev.total_cost_usd),
    durationMs: num(ev.duration_ms),
  };
}

/** Parse the Agent NDJSON sink body into llm_calls rows (skips blank, unparseable, and
 *  non-`result` lines, and lines with no resolvable task id). */
export function parseAgentEvents(ndjson: string): LlmCallRow[] {
  const rows: LlmCallRow[] = [];

  for (const line of ndjson.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    let envelope: unknown;

    try {
      envelope = JSON.parse(line);
    } catch {
      continue;
    }
    const row = rowFromEnvelope(envelope);

    if (row) {
      rows.push(row);
    }
  }

  return rows;
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
