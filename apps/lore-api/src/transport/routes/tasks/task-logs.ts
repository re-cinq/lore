import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { zodResponse } from "../../http/zod-response.js";
import { rethrowBoom, apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { errorMessage } from "@re-cinq/lore-shared";
import { PgAgentRunTurns } from "@re-cinq/lore-shared/project/agent-run-turns/agent-run-turns-pg.js";
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
import { DB_UNAVAILABLE, offsetParam } from "../common-schemas.js";
import {
  readTurnSlice,
  parseTurnCursor,
  type TurnSlice,
} from "./task-logs-turn-scan.js";
import { OkSchema } from "../../http/ok-schema.js";

const TaskLogsBody = z.object({
  task_id: z.string().min(1),
  repo: z.string().min(1),
  logs: z.string().min(1),
});

type TaskLogsBody = z.infer<typeof TaskLogsBody>;

const TaskLogsQuery = z.object({
  task_id: z.string().min(1),
  repo: z.string().min(1).optional(),
  offset: offsetParam,
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

const LogsAcceptedSchema = OkSchema;

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
    handler: (request, h) => storeTaskLogs(request, h),
  };
}

/** Stores one local run's whole buffer; a re-POST overwrites rather than appends. */
async function storeTaskLogs(
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  try {
    const { task_id, repo, logs } = request.payload as TaskLogsBody;
    const bucket = await logBucket();

    await bucket
      .file(`${repo}/${task_id}/output.log`)
      .save(logs, { resumable: false, contentType: "text/plain" });

    return h.response({ ok: true });
  } catch (err) {
    return h.response({ error: errorMessage(err) }).code(500);
  }
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
    handler: (request, h) => serveTaskLogs(getPool, request, h),
  };
}

async function serveTaskLogs(
  getPool: () => Pool | null,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const query = request.query as unknown as TaskLogsQuery;

  try {
    return h.response(await readTranscript(getPool(), query));
  } catch (err) {
    // A guard's refusal already carries its status; only an unexpected failure is this block's to shape.
    rethrowBoom(err);

    return h.response({ error: errorMessage(err) }).code(500);
  }
}

/** A slice of one task's transcript, from whichever source holds it. The TURN STORE is read first: a cluster run streams into `pipeline.agent_run_turns` while it works, and the log bucket is only ever written by the mcp local runner — so a cluster task has turns and no bucket, and a local one has the reverse. */
async function readTranscript(
  pool: Pool | null,
  query: TaskLogsQuery,
): Promise<object> {
  const { task_id: taskId, offset } = query;
  const stored = await resolveTurnStore(pool, taskId, offset, query.cursor);

  if (stored && stored.turnSlice.sawTurns) {
    return turnStoreSliceResponse(stored, offset);
  }
  const repo = resolvedRepo(query.repo ?? null, stored);

  enforceTrue(repo || pool, apiError(503), DB_UNAVAILABLE);
  enforceTrue(repo, apiError(404), `task not found: ${taskId}`);

  return readLogsBucket({
    pool,
    repo,
    taskId,
    offset,
    finished: turnStoreFinished(stored),
  });
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

function resolvedRepo(
  requestedRepo: string | null,
  stored: TurnStoreRead | null,
): string | null {
  if (requestedRepo) {
    return requestedRepo;
  }

  return stored?.taskRepo ?? null;
}

function turnStoreFinished(stored: TurnStoreRead | null): boolean {
  return stored ? stored.finished : false;
}

interface LogsBucketRead {
  pool: Pool | null;
  repo: string;
  taskId: string;
  offset: number;
  finished: boolean;
}

interface TranscriptSlice {
  logs: string;
  next_offset: number;
  complete: boolean;
}

async function readLogsBucket({
  pool,
  repo,
  taskId,
  offset,
  finished,
}: LogsBucketRead): Promise<TranscriptSlice> {
  const bucket = await logBucket();
  const file = bucket.file(`${repo}/${taskId}/output.log`);
  const [exists] = await file.exists();

  if (!exists) {
    return { logs: "", next_offset: 0, complete: finished };
  }

  // The local runner re-POSTs the full buffer while running, so a bucket hit doesn't mean the run ended; no pool means no status to check.
  return downloadedSlice(file, offset, { complete: pool ? finished : true });
}

/** The GCS bucket the mcp local runner's log buffers live in; imported lazily so a deployment without GCS never loads the client. */
async function logBucket() {
  const { Storage } = await import("@google-cloud/storage");

  return new Storage().bucket(process.env.LORE_LOG_BUCKET || "lore-task-logs");
}

type LogFile = ReturnType<Awaited<ReturnType<typeof logBucket>>["file"]>;

/** The stored buffer from `offset` on. The whole object is downloaded because GCS holds it as one blob — there is no server-side range this read could push down. */
async function downloadedSlice(
  file: LogFile,
  offset: number,
  { complete }: { complete: boolean },
): Promise<TranscriptSlice> {
  const [content] = await file.download();
  const full = content.toString("utf-8");

  return { logs: full.substring(offset), next_offset: full.length, complete };
}
