import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { rethrowBoom, apiError } from "../../../server/api-error.js";
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
 */
function wrapTaskEnvelope(taskId: string, rawLine: string): string {
  return `{"source":{"task":${JSON.stringify(taskId)}},"event":${rawLine}}`;
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

      enforceTrue(
        floorUrl && internalToken,
        apiError(503),
        "floor relay not configured",
      );

      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);

      try {
        // The task id keys everything the sink writes (llm_calls, run events,
        // turns), so an unknown id is refused rather than stored uncorrelated.
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
        const relayable = lines.filter(relayableEvent);
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
            .map((line) => wrapTaskEnvelope(taskId, line))
            .join("\n"),
        });

        if (!upstream.ok) {
          return h
            .response({ error: `floor relay failed: ${upstream.status}` })
            .code(502);
        }

        return h.response({ forwarded: relayable.length, skipped });
      } catch (err) {
        // A guard's refusal already carries its status; only an unexpected failure
        // is this block's to shape.
        rethrowBoom(err);

        return h.response({ error: errorMessage(err) }).code(500);
      }
    },
  };
}
