import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { rethrowBoom, apiError } from "../../../server/api-error.js";
import { errorMessage } from "@re-cinq/lore-shared";
import { PgAgentRunTurns } from "@re-cinq/lore-shared/project/agent-run-turns/agent-run-turns-pg.js";
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";
import {
  readTurnSlice,
  parseTurnCursor,
  type TurnSlice,
} from "./task-logs-turn-scan.js";

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

// Both verbs need "write" scope per-route (specs/api-routes/task-logs/spec.md); `next_offset`/`cursor` are how a poller resumes (cursor rides the turn store, offset the legacy bucket read).
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

const ACTIVE_STATUSES = new Set([
  "pending",
  "queued",
  "running",
  "running-local",
  "awaiting_approval",
]);

interface TurnStoreRead {
  finished: boolean;
  taskRepo: string | null;
  turnSlice: TurnSlice;
}

// A task row that no longer exists counts as settled — else turns for a deleted task (kept, no FKs by design) poll forever with complete:false.
async function readFromTurnStore(
  pool: Pool,
  taskId: string,
  offset: number,
  rawCursor: string | undefined,
): Promise<TurnStoreRead> {
  const { rows } = await pool.query<{
    status: string;
    target_repo: string | null;
  }>(`SELECT status, target_repo FROM pipeline.tasks WHERE id = $1`, [taskId]);
  const task = rows.at(0);
  const finished = task === undefined || !ACTIVE_STATUSES.has(task.status);
  const turnSlice = await readTurnSlice(
    new PgAgentRunTurns(pool),
    taskId,
    offset,
    parseTurnCursor(rawCursor, taskId, offset),
  );

  return { finished, taskRepo: task?.target_repo ?? null, turnSlice };
}

async function resolveTurnStore(
  pool: Pool | null,
  taskId: string,
  offset: number,
  cursor: string | undefined,
): Promise<TurnStoreRead | null> {
  if (!pool) {
    return null;
  }

  return readFromTurnStore(pool, taskId, offset, cursor);
}

function turnStoreFinished(stored: TurnStoreRead | null): boolean {
  return stored ? stored.finished : false;
}

function resolvedRepo(
  requestedRepo: string | null,
  stored: TurnStoreRead | null,
): string | null {
  if (requestedRepo) {
    return requestedRepo;
  }

  return stored?.taskRepo ?? null;
}

function turnStoreSliceResponse(
  stored: TurnStoreRead,
  offset: number,
): {
  logs: string;
  next_offset: number;
  complete: boolean;
  cursor: string;
} {
  const { turnSlice, finished } = stored;

  return {
    logs: turnSlice.slice,
    next_offset: offset + turnSlice.slice.length,
    complete: finished && !turnSlice.hasMore,
    cursor: turnSlice.cursor,
  };
}

interface LogsBucketRead {
  pool: Pool | null;
  repo: string;
  taskId: string;
  offset: number;
  finished: boolean;
}

async function readLogsBucket({
  pool,
  repo,
  taskId,
  offset,
  finished,
}: LogsBucketRead): Promise<{
  logs: string;
  next_offset: number;
  complete: boolean;
}> {
  const { Storage } = await import("@google-cloud/storage");
  const bucket = new Storage().bucket(
    process.env.LORE_LOG_BUCKET || "lore-task-logs",
  );
  const file = bucket.file(`${repo}/${taskId}/output.log`);
  const [exists] = await file.exists();

  if (!exists) {
    return { logs: "", next_offset: 0, complete: finished };
  }
  const [content] = await file.download();
  const full = content.toString("utf-8");

  // The local runner re-POSTs the full buffer while running, so a bucket hit doesn't mean the run ended; no pool means no status to check.
  return {
    logs: full.substring(offset),
    next_offset: full.length,
    complete: pool ? finished : true,
  };
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

        // Cluster runs stream to pipeline.agent_run_turns; the bucket is only ever written by the mcp local runner, so the turn store is read first.
        const stored = await resolveTurnStore(
          pool,
          taskId,
          offset,
          query.cursor,
        );
        const finished = turnStoreFinished(stored);

        if (stored && stored.turnSlice.sawTurns) {
          return h.response(turnStoreSliceResponse(stored, offset));
        }
        repo = resolvedRepo(repo, stored);

        enforceTrue(repo || pool, apiError(503), DB_UNAVAILABLE);
        enforceTrue(repo, apiError(404), `task not found: ${taskId}`);

        return h.response(
          await readLogsBucket({ pool, repo, taskId, offset, finished }),
        );
      } catch (err) {
        // A guard's refusal already carries its status; only an unexpected failure is this block's to shape.
        rethrowBoom(err);

        return h.response({ error: errorMessage(err) }).code(500);
      }
    },
  };
}
