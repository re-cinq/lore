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

// Parses `<taskId>:<rowId>:<chars>`; trusted only for this task with chars<=offset (offset 0 always ignores it), and an id past PG bigint range is rejected to avoid a 500 in `id > $2::bigint`.
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

// Flattens turns to the UTF-16 slice [offset, offset+LOG_SLICE_MAX); `resume` seeks straight to the previous cursor's row boundary instead of re-paging the whole prefix (#1307) — a stale/forged offset past the boundary falls back to a full rescan from row id 0, while an at-boundary cursor is trusted as-is (bearer-scoped, so a forged skip only affects the forger's own read); a rewind below the boundary self-heals the same way.
async function readTurnSlice(
  turns: AgentRunTurnsRepository,
  taskId: string,
  offset: number,
  resume: TurnResume | null,
): Promise<TurnSlice> {
  const state: TurnScanState = {
    consumed: resume?.consumed ?? 0,
    boundaryId: resume?.afterId ?? "0",
    boundaryChars: resume?.consumed ?? 0,
    slice: "",
    mustValidateResume: resume !== null && offset > resume.consumed,
  };
  let afterId = resume?.afterId ?? "0";
  let sawTurns = resume !== null;

  for (;;) {
    const page = await turns.listByTask(taskId, afterId, TURNS_PAGE_SIZE);

    sawTurns = sawTurns || page.length > 0;

    if (state.mustValidateResume && page.length === 0) {
      return readTurnSlice(turns, taskId, offset, null);
    }
    const outcome = consumeTurnPage(state, page, offset);

    if (outcome === "restart") {
      return readTurnSlice(turns, taskId, offset, null);
    }

    if (outcome === "sliced") {
      return {
        slice: state.slice,
        hasMore: true,
        sawTurns,
        cursor: `${taskId}:${state.boundaryId}:${state.boundaryChars}`,
      };
    }

    if (page.length < TURNS_PAGE_SIZE) {
      return {
        slice: state.slice,
        hasMore: false,
        sawTurns,
        cursor: `${taskId}:${state.boundaryId}:${state.boundaryChars}`,
      };
    }
    afterId = page.at(-1)?.id ?? afterId;
  }
}

interface TurnScanState {
  consumed: number;
  boundaryId: string;
  boundaryChars: number;
  slice: string;
  mustValidateResume: boolean;
}

// Folds one page into the scan state: "restart" when the resume cursor proves stale, "sliced" when the slice budget is exhausted mid-page, else null.
function consumeTurnPage(
  state: TurnScanState,
  page: Awaited<ReturnType<AgentRunTurnsRepository["listByTask"]>>,
  offset: number,
): "restart" | "sliced" | null {
  for (const row of page) {
    if (state.slice.length >= LOG_SLICE_MAX) {
      return "sliced";
    }
    const line = `${JSON.stringify(row.envelope)}\n`;
    const lineEndsBeforeOffset = state.consumed + line.length <= offset;

    if (state.mustValidateResume && lineEndsBeforeOffset) {
      return "restart";
    }
    state.mustValidateResume = false;

    if (lineEndsBeforeOffset) {
      state.consumed += line.length;
      state.boundaryId = row.id;
      state.boundaryChars = state.consumed;
      continue;
    }
    const start = Math.max(0, offset - state.consumed);
    const piece = line.substring(
      start,
      start + (LOG_SLICE_MAX - state.slice.length),
    );

    state.slice += piece;

    if (start + piece.length < line.length) {
      return "sliced";
    }
    state.consumed += line.length;
    state.boundaryId = row.id;
    state.boundaryChars = state.consumed;
  }

  return null;
}

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
  const task = rows[0];
  const finished = task === undefined || !ACTIVE_STATUSES.has(task.status);
  const turnSlice = await readTurnSlice(
    new PgAgentRunTurns(pool),
    taskId,
    offset,
    parseTurnCursor(rawCursor, taskId, offset),
  );

  return { finished, taskRepo: task?.target_repo ?? null, turnSlice };
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

        // Cluster runs stream to pipeline.agent_run_turns; the bucket is only ever written by the mcp local runner, so the turn store is read first.
        const stored = pool
          ? await readFromTurnStore(pool, taskId, offset, query.cursor)
          : null;

        finished = stored?.finished ?? false;

        if (stored?.turnSlice.sawTurns) {
          const { turnSlice } = stored;

          return h.response({
            logs: turnSlice.slice,
            next_offset: offset + turnSlice.slice.length,
            complete: finished && !turnSlice.hasMore,
            cursor: turnSlice.cursor,
          });
        }
        repo = repo ?? stored?.taskRepo ?? null;

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

        // The local runner re-POSTs the full buffer while running, so a bucket hit doesn't mean the run ended; no pool means no status to check.
        return h.response({
          logs: full.substring(offset),
          next_offset: full.length,
          complete: pool ? finished : true,
        });
      } catch (err) {
        // A guard's refusal already carries its status; only an unexpected failure is this block's to shape.
        rethrowBoom(err);

        return h.response({ error: errorMessage(err) }).code(500);
      }
    },
  };
}
