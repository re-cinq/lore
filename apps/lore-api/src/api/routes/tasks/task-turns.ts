import { createHash } from "node:crypto";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { errorMessage } from "@re-cinq/lore-shared";
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { rawBody } from "../../../server/raw-body.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";

const TaskTurnsParams = z.object({
  taskId: z.string().uuid(),
});

/**
 * The wrap side of the station contract's attribution envelope
 * (libs/assembly-lines/src/agent-output.ts holds the unwrap side; the pod-side
 * wrap lives in the ai-agent-subsystem, out of repo). The raw line is embedded
 * verbatim so the Floor's turn store keeps the exact bytes the laptop redacted.
 * `turn_key` is this relay's idempotency stamp (#1389): the Floor's turn store
 * skips a key it already holds, so a retried POST cannot duplicate rows.
 */
function wrapTaskEnvelope(
  taskId: string,
  rawLine: string,
  turnKey: string,
): string {
  return `{"source":{"task":${JSON.stringify(taskId)},"turn_key":${JSON.stringify(turnKey)}},"event":${rawLine}}`;
}

function turnKey(taskId: string, slot: number, line: string): string {
  return createHash("sha256")
    .update(`${taskId}\n${slot}\n${line}`)
    .digest("hex");
}

/**
 * The `x-turn-offset` header: the position of this POST's first line within
 * the runner's full transcript buffer. Absent or malformed (an older runner)
 * → null, and keying falls back to per-POST occurrence numbering.
 */
function parseTurnOffset(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{1,15}$/.test(value)) {
    return null;
  }

  return Number(value);
}

/**
 * The relayable lines, each with its dedup key: sha256 over (task, slot, line
 * bytes). With an offset the slot is the line's position in the whole
 * transcript, so a full-buffer re-POST — including one whose tail batch grew —
 * reproduces the keys of every line it already sent. The occurrence fallback
 * numbers byte-identical copies within one POST, which keys a same-body retry
 * identically while keeping legitimate repeats distinct; its known limit is
 * byte-identical lines in DIFFERENT POSTs, which collide at occurrence 0 (the
 * Floor counts such skips as `turn_deduped`).
 */
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

/**
 * A relayed line must be a plain claude stream-json event. Two shapes are
 * refused because the Floor's sink acts on them beyond storing the turn:
 *  - an attributed envelope ({source, event}) — unwrapAttribution's double-peel
 *    merges the inner source, letting a laptop forge an agent CR name or a
 *    carried run identity onto a real assembly run;
 *  - a kind:"file" event — it drives planning-round settlement and assembly-line
 *    artifact merge (deliverPlanningResults / deliverArtifact).
 * Legitimate `claude --print` output never emits either shape.
 */
function relayableEvent(line: string): boolean {
  let parsed: unknown;

  try {
    parsed = JSON.parse(line);
  } catch {
    return false;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return false;
  }

  const record = parsed as Record<string, unknown>;

  return !("source" in record && "event" in record) && record.kind !== "file";
}

/**
 * POST /api/task-turns/{taskId} — relays a locally-run task's redacted claude
 * stream-json transcript to the Floor's /api/agent-events sink, so local runs
 * land in pipeline.agent_run_turns like cluster runs (issue #1295). The Floor
 * ingress is deliberately cluster-internal; laptops reach it through this
 * relay with the write-scoped token they already hold, and lore-api attaches
 * the internal token it already mounts.
 *
 * Body is raw NDJSON (payload.parse: false) — one claude stream-json line per
 * row, already redacted on the laptop before anything left the machine.
 */
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

      if (!floorUrl || !internalToken) {
        return h.response({ error: "floor relay not configured" }).code(503);
      }

      const pool = getPool();

      if (!pool) {
        return h.response({ error: DB_UNAVAILABLE }).code(503);
      }

      try {
        // The task id keys everything the sink writes (llm_calls, run events,
        // turns), so an unknown id is refused rather than stored uncorrelated.
        const { rows } = await pool.query(
          `SELECT id FROM pipeline.tasks WHERE id = $1`,
          [taskId],
        );

        if (rows.length === 0) {
          return h.response({ error: `task not found: ${taskId}` }).code(404);
        }

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
        return h.response({ error: errorMessage(err) }).code(500);
      }
    },
  };
}
