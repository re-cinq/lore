import { createHash } from "node:crypto";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { zodResponse } from "../../http/zod-response.js";
import { rethrowBoom, apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { errorMessage } from "@re-cinq/lore-shared";
import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { z } from "zod";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodValidate } from "../../http/zod-validate.js";
import { rawBody } from "@re-cinq/lore-shared/http/raw-body.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";
import { PgAgentRunTurns } from "@re-cinq/lore-shared/project/agent-run-turns/agent-run-turns-pg.js";
import type { AgentRunTurnInsert } from "@re-cinq/lore-shared/project/agent-run-turns/agent-run-turns-port.js";

const TaskTurnsParams = z.object({
  taskId: z.string().uuid(),
});

/** How many relayed turns were stored, and how many the filter skipped. */
const TurnsRelayedSchema = z.object({
  forwarded: z.number(),
  skipped: z.number(),
});

const TURNS_ROUTE_OPTIONS = zodResponse(
  {
    ...bearerScope("write"),
    validate: { params: zodValidate(TaskTurnsParams) },
    payload: { parse: false },
    app: {
      rawBody: {
        contentType: "application/x-ndjson",
        description:
          "Raw NDJSON body — one claude stream-json line per row, already redacted on the laptop before anything left the machine.",
      },
    },
  },
  TurnsRelayedSchema,
  {
    name: "TurnsRelayed",
    description: "Turns accepted from a local runner",
  },
);

export function taskTurnsPostRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/task-turns/{taskId}",
    options: TURNS_ROUTE_OPTIONS,
    handler: (request, h) => serveTurnsPost(getPool, request, h),
  };
}

async function serveTurnsPost(
  getPool: () => Pool | null,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const { taskId } = request.params as z.infer<typeof TaskTurnsParams>;
  const pool = getPool();

  enforceTrue(pool, apiError(503), DB_UNAVAILABLE);

  try {
    return h.response(await storeTurns(pool, taskId, turnsBody(request)));
  } catch (err) {
    // A guard's refusal already carries its status; only an unexpected failure is this block's to shape.
    rethrowBoom(err);

    return h.response({ error: errorMessage(err) }).code(500);
  }
}

/** The POST's own payload: the raw NDJSON plus the offset that keys it into the whole transcript. */
function turnsBody(request: Request): { raw: string; offset: number | null } {
  return {
    raw: rawBody(request),
    offset: parseTurnOffset(request.headers["x-turn-offset"]),
  };
}

// The `x-turn-offset` header: this POST's first line's position in the full transcript; absent/malformed (older runner) → null, falls back to per-POST occurrence numbering.
function parseTurnOffset(value: unknown): number | null {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,14})$/.test(value)) {
    return null;
  }

  return Number(value);
}

type StoreResult = { forwarded: number; skipped: number };

// Stores a local run's redacted transcript in pipeline.agent_run_turns, keyed by its task, like a cluster run's (#1295). Lore's own Floor used to take these through its agent-events sink; this service writes them itself now that the Floor is gone.
async function storeTurns(
  pool: Pool,
  taskId: string,
  body: { raw: string; offset: number | null },
): Promise<StoreResult> {
  await enforceTaskExists(pool, taskId);
  const lines = transcriptLines(body.raw);
  const storable = keyedRelayableLines(taskId, lines, body.offset);

  await new PgAgentRunTurns(pool).insertBatch(
    storable.map((turn) => turnRow(taskId, turn)),
  );

  return {
    forwarded: storable.length,
    skipped: lines.length - storable.length,
  };
}

/** One row of the turn store. The envelope is the line wrapped with its task and its KEY, and the key is also the row's dedup key, which is what makes a resend idempotent: a retried POST skips the rows already stored. */
function turnRow(
  taskId: string,
  { line, key }: { line: string; key: string },
): AgentRunTurnInsert {
  return {
    taskId,
    agentCrName: null,
    eventType: eventTypeOf(line),
    envelope: wrapTaskEnvelope(taskId, line, key),
    dedupKey: key,
  };
}

function eventTypeOf(line: string): string | null {
  const type = (JSON.parse(line) as { type?: unknown }).type;

  return typeof type === "string" ? type : null;
}

/** The task id keys everything the sink writes, so an unknown id is REFUSED rather than stored uncorrelated. */
async function enforceTaskExists(pool: Pool, taskId: string): Promise<void> {
  const { rows } = await pool.query(
    `SELECT id FROM pipeline.tasks WHERE id = $1`,
    [taskId],
  );

  enforceTrue(rows.length !== 0, apiError(404), `task not found: ${taskId}`);
}

function transcriptLines(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

// Dedup key = sha256(task, slot, line); with an offset the slot is the line's position in the whole transcript so a re-POST reproduces prior keys, else an occurrence fallback keys same-body retries identically (known limit: byte-identical lines across DIFFERENT POSTs collide at occurrence 0 and the second is skipped as a duplicate).
function keyedRelayableLines(
  taskId: string,
  lines: string[],
  offset: number | null,
): Array<{ line: string; key: string }> {
  const occurrences = new Map<string, number>();
  const keyed: Array<{ line: string; key: string }> = [];

  lines.forEach((line, index) => {
    const occurrence = occurrences.get(line) ?? 0;

    occurrences.set(line, occurrence + 1);

    if (!relayableEvent(line)) {
      return;
    }
    const slot = offset === null ? occurrence : offset + index;

    keyed.push({ line, key: turnKey(taskId, slot, line) });
  });

  return keyed;
}

// Refuses an attributed envelope ({source,event} — could forge an agent CR/run identity via unwrapAttribution's double-peel) and a kind:"file" event (drives planning/artifact merge); legitimate `claude --print` output never emits either.
function relayableEvent(line: string): boolean {
  let parsed: unknown;

  try {
    parsed = JSON.parse(line);
  } catch {
    return false;
  }

  if (!isPlainRecord(parsed)) {
    return false;
  }

  return !isAttributedEnvelope(parsed) && parsed.kind !== "file";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAttributedEnvelope(record: Record<string, unknown>): boolean {
  return "source" in record && "event" in record;
}

function turnKey(taskId: string, slot: number, line: string): string {
  return createHash("sha256")
    .update(`${taskId}\n${slot}\n${line}`)
    .digest("hex");
}

// The attribution envelope a turn is stored in, the same shape a cluster run's turns carry; `turn_key` is this route's idempotency stamp (#1389).
function wrapTaskEnvelope(
  taskId: string,
  rawLine: string,
  key: string,
): string {
  return `{"source":{"task":${JSON.stringify(taskId)},"turn_key":${JSON.stringify(key)}},"event":${rawLine}}`;
}
