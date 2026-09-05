import { createHash } from "node:crypto";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { rethrowBoom, apiError } from "../../../server/api-error.js";
import { errorMessage } from "@re-cinq/lore-shared";
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { rawBody } from "@re-cinq/lore-shared/http/raw-body.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";

const TaskTurnsParams = z.object({
  taskId: z.string().uuid(),
});

// Wrap side of the station contract's attribution envelope (unwrap is agent-output.ts); `turn_key` is this relay's idempotency stamp (#1389) — the Floor's turn store skips a key it already holds.
function wrapTaskEnvelope(
  taskId: string,
  rawLine: string,
  key: string,
): string {
  return `{"source":{"task":${JSON.stringify(taskId)},"turn_key":${JSON.stringify(key)}},"event":${rawLine}}`;
}

function turnKey(taskId: string, slot: number, line: string): string {
  return createHash("sha256")
    .update(`${taskId}\n${slot}\n${line}`)
    .digest("hex");
}

// The `x-turn-offset` header: this POST's first line's position in the full transcript; absent/malformed (older runner) → null, falls back to per-POST occurrence numbering.
function parseTurnOffset(value: unknown): number | null {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,14})$/.test(value)) {
    return null;
  }

  return Number(value);
}

// Dedup key = sha256(task, slot, line); with an offset the slot is the line's position in the whole transcript so a re-POST reproduces prior keys, else an occurrence fallback keys same-body retries identically (known limit: byte-identical lines across DIFFERENT POSTs collide at occurrence 0 — Floor counts these as `turn_deduped`).
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAttributedEnvelope(record: Record<string, unknown>): boolean {
  return "source" in record && "event" in record;
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

// Relays a local run's redacted transcript to the Floor's cluster-internal /api/agent-events sink so it lands in pipeline.agent_run_turns like cluster runs (#1295); lore-api attaches the internal token laptops can't hold.
/** How many relayed turns were stored, and how many the filter skipped. */
const TurnsRelayedSchema = z.object({
  forwarded: z.number(),
  skipped: z.number(),
});

export function taskTurnsPostRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/task-turns/{taskId}",
    options: zodResponse(
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
    ),
    handler: async (request, h) => {
      const { taskId } = request.params as z.infer<typeof TaskTurnsParams>;
      const floorUrl = process.env.LORE_AGENT_URL;
      const internalToken = process.env.LORE_AGENT_INTERNAL_TOKEN;

      enforceTrue(
        floorUrl && internalToken,
        apiError(503),
        "floor relay not configured",
      );

      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);

      try {
        // The task id keys everything the sink writes — an unknown id is refused rather than stored uncorrelated.
        const { rows } = await pool.query(
          `SELECT id FROM pipeline.tasks WHERE id = $1`,
          [taskId],
        );

        enforceTrue(
          rows.length !== 0,
          apiError(404),
          `task not found: ${taskId}`,
        );

        const lines = rawBody(request)
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        const offset = parseTurnOffset(request.headers["x-turn-offset"]);
        const relayable = keyedRelayableLines(taskId, lines, offset);
        const skipped = lines.length - relayable.length;

        if (relayable.length === 0) {
          return h.response({ forwarded: 0, skipped });
        }

        const upstream = await fetch(`${floorUrl}/api/agent-events`, {
          signal: AbortSignal.timeout(30_000),
          method: "POST",
          headers: {
            Authorization: `Bearer ${internalToken}`,
            "Content-Type": "application/x-ndjson",
          },
          body: relayable
            .map(({ line, key }) => wrapTaskEnvelope(taskId, line, key))
            .join("\n"),
        });

        if (!upstream.ok) {
          return h
            .response({ error: `floor relay failed: ${upstream.status}` })
            .code(502);
        }

        return h.response({ forwarded: relayable.length, skipped });
      } catch (err) {
        // A guard's refusal already carries its status; only an unexpected failure is this block's to shape.
        rethrowBoom(err);

        return h.response({ error: errorMessage(err) }).code(500);
      }
    },
  };
}
