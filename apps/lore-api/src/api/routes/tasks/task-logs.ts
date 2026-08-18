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
});

type TaskLogsQuery = z.infer<typeof TaskLogsQuery>;

// Both verbs require the "write" scope, matching the canonical route spec
// (specs/api-routes/task-logs/spec.md) and the original method-agnostic
// "/api/task-logs"→"write" scope map. The legacy prefix matcher resolved
// "/api/task-logs".startsWith("/api/task") first, silently shadowing that entry
// with "task"; per-route declaration removes the collision.
export function taskLogsPostRoute(): ServerRoute {
  return {
    method: "POST",
    path: "/api/task-logs",
    options: {
      ...bearerScope("write"),
      validate: { payload: zodValidate(TaskLogsBody) },
    },
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
}

/**
 * Flatten a task's turns (one `JSON.stringify(envelope)` NDJSON line each) and
 * return the UTF-16 code-unit slice `[offset, offset + LOG_SLICE_MAX)`. The
 * prefix before `offset` is length-counted and dropped, never accumulated, so
 * peak memory is one slice plus one page regardless of how deep the caller has
 * paged. Offsets are stable across polls because rows are append-only and
 * jsonb key order is deterministic — except when concurrent ingest POSTs
 * commit out of id order, which can splice a late row into an already-read
 * prefix; a re-poll from an earlier offset self-heals.
 */
async function readTurnSlice(
  turns: AgentRunTurnsRepository,
  taskId: string,
  offset: number,
): Promise<TurnSlice> {
  let consumed = 0;
  let slice = "";
  let sawTurns = false;
  let cursor = "0";

  for (;;) {
    const page = await turns.listByTask(taskId, cursor, TURNS_PAGE_SIZE);

    sawTurns = sawTurns || page.length > 0;

    for (const row of page) {
      if (slice.length >= LOG_SLICE_MAX) {
        return { slice, hasMore: true, sawTurns };
      }
      const line = `${JSON.stringify(row.envelope)}\n`;

      if (consumed + line.length <= offset) {
        consumed += line.length;
        continue;
      }
      const start = Math.max(0, offset - consumed);
      const piece = line.substring(
        start,
        start + (LOG_SLICE_MAX - slice.length),
      );

      slice += piece;

      if (start + piece.length < line.length) {
        return { slice, hasMore: true, sawTurns };
      }
      consumed += line.length;
    }

    if (page.length < TURNS_PAGE_SIZE) {
      return { slice, hasMore: false, sawTurns };
    }
    cursor = page.at(-1)?.id ?? cursor;
  }
}

export function taskLogsGetRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/task-logs",
    options: {
      ...bearerScope("write"),
      validate: { query: zodValidate(TaskLogsQuery) },
    },
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
          );

          if (turnSlice.sawTurns) {
            return h.response({
              logs: turnSlice.slice,
              next_offset: offset + turnSlice.slice.length,
              complete: finished && !turnSlice.hasMore,
            });
          }
          repo = repo ?? task?.target_repo ?? null;
        }

        if (!repo && !pool) {
          return h.response({ error: DB_UNAVAILABLE }).code(503);
        }

        if (!repo) {
          return h.response({ error: `task not found: ${taskId}` }).code(404);
        }
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
        return h.response({ error: errorMessage(err) }).code(500);
      }
    },
  };
}
