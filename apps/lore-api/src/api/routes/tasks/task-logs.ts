import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { rethrowBoom, apiError } from "../../../server/api-error.js";
import { errorMessage } from "@re-cinq/lore-shared";
import type { AgentRunTurnsRepository } from "@re-cinq/lore-shared";
import { PgAgentRunTurns } from "@re-cinq/lore-shared/project/agent-run-turns/agent-run-turns-pg.js";
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";

const TaskLogsBody = z.object({
  task_id: z.string().min(1),
  repo: z.string().min(1),
  logs: z.string().min(1),
});

type TaskLogsBody = z.infer<typeof TaskLogsBody>;

const TaskLogsQuery = z.object({
  task_id: z.string().min(1),
  repo: z.string().min(1).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  cursor: z.string().optional(),
});

type TaskLogsQuery = z.infer<typeof TaskLogsQuery>;

// Both verbs require the "write" scope, matching the canonical route spec
// (specs/api-routes/task-logs/spec.md) and the original method-agnostic
// "/api/task-logs"→"write" scope map. The legacy prefix matcher resolved
// "/api/task-logs".startsWith("/api/task") first, silently shadowing that entry
// with "task"; per-route declaration removes the collision.
/**
 * A slice of a task's transcript. `next_offset` and `cursor` are how a poller
 * resumes: the cursor rides the turn store, the offset the legacy bucket read.
 */
const TaskLogSliceSchema = z.object({
  logs: z.string(),
  next_offset: z.number(),
  complete: z.boolean(),
  cursor: z.string().optional(),
});

const LogsAcceptedSchema = z.object({ ok: z.literal(true) });

export function taskLogsPostRoute(): ServerRoute {
  return {
    method: "POST",
    path: "/api/task-logs",
    options: zodResponse(
      {
        ...bearerScope("write"),
        validate: { payload: zodValidate(TaskLogsBody) },
      },
      LogsAcceptedSchema,
      { name: "TaskLogsAccepted", description: "The log buffer was stored" },
    ),
    handler: async (request, h) => {
      try {
        const { task_id, repo, logs } = request.payload as TaskLogsBody;
        const { Storage } = await import("@google-cloud/storage");
        const bucket = new Storage().bucket(
          process.env.LORE_LOG_BUCKET || "lore-task-logs",
        );

        await bucket
          .file(`${repo}/${task_id}/output.log`)
          .save(logs, { resumable: false, contentType: "text/plain" });

        return h.response({ ok: true });
      } catch (err) {
        return h.response({ error: errorMessage(err) }).code(500);
      }
    },
  };
}

const LOG_SLICE_MAX = 256 * 1024;

const TURNS_PAGE_SIZE = 1000;

const ACTIVE_STATUSES = new Set([
  "pending",
  "queued",
  "running",
  "running-local",
  "awaiting_approval",
]);

interface TurnSlice {
  slice: string;
  hasMore: boolean;
  sawTurns: boolean;
  cursor: string;
}

interface TurnResume {
  afterId: string;
  consumed: number;
}

const PG_BIGINT_MAX = 9223372036854775807n;

/**
 * Parse a `<taskId>:<rowId>:<chars>` resume cursor. Only a cursor minted for
 * this task whose char count does not exceed the requested offset is trusted;
 * at offset 0 the caller wants the full transcript, so any cursor is ignored.
 * Row ids are string-encoded bigints and stay strings end to end; an id past
 * the PG bigint range would 500 inside `id > $2::bigint`, so it is rejected
 * here and falls back to the full re-scan like every other untrusted cursor.
 */
function parseTurnCursor(
  raw: string | undefined,
  taskId: string,
  offset: number,
): TurnResume | null {
  if (!raw || offset === 0) {
    return null;
  }
  const match = /^(.+):(\d{1,19}):(\d{1,19})$/.exec(raw);

  if (!match) {
    return null;
  }
  const [, cursorTask, afterId, chars] = match;
  const consumed = Number(chars);

  if (
    cursorTask !== taskId ||
    consumed > offset ||
    BigInt(afterId) > PG_BIGINT_MAX
  ) {
    return null;
  }

  return { afterId, consumed };
}

/**
 * Flatten a task's turns (one `JSON.stringify(envelope)` NDJSON line each) and
 * return the UTF-16 code-unit slice `[offset, offset + LOG_SLICE_MAX)`. The
 * prefix before `offset` is length-counted and dropped, never accumulated, so
 * peak memory is one slice plus one page regardless of how deep the caller has
 * paged.
 *
 * `resume` seeks straight to the last row boundary a previous response minted
 * as its `cursor` instead of re-paging the whole prefix (#1307). When the
 * resumed offset sits past the boundary (`offset > chars`) it must land
 * strictly inside the first row after `rowId` — anything else means the cursor
 * is stale or forged, and the read restarts as a full authoritative scan from
 * row id 0; the restart recurses at most once, since it passes `resume: null`,
 * which disarms the validation. At the boundary itself (`offset == chars`) the
 * pair is trusted as-is: server-minted cursors are self-consistent with real
 * rows, and verifying the boundary would take the very prefix scan this resume
 * avoids. The accepted consequence is that a caller can forge
 * `<taskId>:<rowId>:<offset>` at the boundary and skip rows — reads are
 * bearer-scoped and the damage is confined to the forger's own response.
 * The returned `cursor` names the last fully consumed row and the flattened
 * char count through its end; when a request consumes no full row it echoes
 * the resume point, so an idle tail-follow poll stays O(new rows).
 *
 * Offsets are stable across polls because rows are append-only and jsonb key
 * order is deterministic — except when concurrent ingest POSTs commit out of
 * id order, which can splice a late row into an already-read prefix. A re-poll
 * from an earlier offset self-heals: any rewind below the boundary rejects the
 * cursor (`chars > offset`) and re-scans from row id 0 on its own.
 */
async function readTurnSlice(
  turns: AgentRunTurnsRepository,
  taskId: string,
  offset: number,
  resume: TurnResume | null,
): Promise<TurnSlice> {
  let consumed = resume?.consumed ?? 0;
  let afterId = resume?.afterId ?? "0";
  let boundaryId = afterId;
  let boundaryChars = consumed;
  let slice = "";
  let sawTurns = resume !== null;
  let mustValidateResume = resume !== null && offset > consumed;

  for (;;) {
    const page = await turns.listByTask(taskId, afterId, TURNS_PAGE_SIZE);

    sawTurns = sawTurns || page.length > 0;

    if (mustValidateResume && page.length === 0) {
      return readTurnSlice(turns, taskId, offset, null);
    }

    for (const row of page) {
      if (slice.length >= LOG_SLICE_MAX) {
        return {
          slice,
          hasMore: true,
          sawTurns,
          cursor: `${taskId}:${boundaryId}:${boundaryChars}`,
        };
      }
      const line = `${JSON.stringify(row.envelope)}\n`;

      if (mustValidateResume) {
        mustValidateResume = false;

        if (consumed + line.length <= offset) {
          return readTurnSlice(turns, taskId, offset, null);
        }
      }

      if (consumed + line.length <= offset) {
        consumed += line.length;
        boundaryId = row.id;
        boundaryChars = consumed;
        continue;
      }
      const start = Math.max(0, offset - consumed);
      const piece = line.substring(
        start,
        start + (LOG_SLICE_MAX - slice.length),
      );

      slice += piece;

      if (start + piece.length < line.length) {
        return {
          slice,
          hasMore: true,
          sawTurns,
          cursor: `${taskId}:${boundaryId}:${boundaryChars}`,
        };
      }
      consumed += line.length;
      boundaryId = row.id;
      boundaryChars = consumed;
    }

    if (page.length < TURNS_PAGE_SIZE) {
      return {
        slice,
        hasMore: false,
        sawTurns,
        cursor: `${taskId}:${boundaryId}:${boundaryChars}`,
      };
    }
    afterId = page.at(-1)?.id ?? afterId;
  }
}

export function taskLogsGetRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/task-logs",
    options: zodResponse(
      {
        ...bearerScope("write"),
        validate: { query: zodValidate(TaskLogsQuery) },
      },
      TaskLogSliceSchema,
      {
        name: "TaskLogSlice",
        description: "A slice of a task's transcript",
        errors: [404],
      },
    ),
    handler: async (request, h) => {
      const query = request.query as unknown as TaskLogsQuery;
      const taskId = query.task_id;
      const offset = query.offset;
      let repo: string | null = query.repo ?? null;

      try {
        const pool = getPool();
        let finished = false;

        // Cluster runs stream to pipeline.agent_run_turns (the bucket object is
        // only ever written by the mcp local runner), so the turn store is read
        // first and GCS is the local-runner fallback.
        if (pool) {
          const { rows } = await pool.query<{
            status: string;
            target_repo: string | null;
          }>(`SELECT status, target_repo FROM pipeline.tasks WHERE id = $1`, [
            taskId,
          ]);
          const task = rows[0];

          // A task row that no longer exists will never transition again, so it
          // counts as settled — otherwise turns for a deleted task (the store
          // keeps them: no FKs, by design) poll forever with complete: false.
          finished = task === undefined || !ACTIVE_STATUSES.has(task.status);
          const turnSlice = await readTurnSlice(
            new PgAgentRunTurns(pool),
            taskId,
            offset,
            parseTurnCursor(query.cursor, taskId, offset),
          );

          if (turnSlice.sawTurns) {
            return h.response({
              logs: turnSlice.slice,
              next_offset: offset + turnSlice.slice.length,
              complete: finished && !turnSlice.hasMore,
              cursor: turnSlice.cursor,
            });
          }
          repo = repo ?? task?.target_repo ?? null;
        }

        enforceTrue(repo || pool, apiError(503), DB_UNAVAILABLE);

        enforceTrue(repo, apiError(404), `task not found: ${taskId}`);
        const { Storage } = await import("@google-cloud/storage");
        const bucket = new Storage().bucket(
          process.env.LORE_LOG_BUCKET || "lore-task-logs",
        );
        const file = bucket.file(`${repo}/${taskId}/output.log`);
        const [exists] = await file.exists();

        if (!exists) {
          return h.response({ logs: "", next_offset: 0, complete: finished });
        }
        const [content] = await file.download();
        const full = content.toString("utf-8");

        // The local runner re-POSTs the full buffer while still running, so a
        // bucket hit does not mean the run ended; without a pool there is no
        // status to consult and the legacy always-complete read stands.
        return h.response({
          logs: full.substring(offset),
          next_offset: full.length,
          complete: pool ? finished : true,
        });
      } catch (err) {
        // A guard's refusal already carries its status; only an unexpected failure
        // is this block's to shape.
        rethrowBoom(err);

        return h.response({ error: errorMessage(err) }).code(500);
      }
    },
  };
}
