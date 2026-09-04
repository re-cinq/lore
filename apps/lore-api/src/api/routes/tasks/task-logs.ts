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

  if (cursorMismatches({ cursorTask, taskId, consumed, offset, afterId })) {
    return null;
  }

  return { afterId, consumed };
}

interface CursorMatch {
  cursorTask: string;
  taskId: string;
  consumed: number;
  offset: number;
  afterId: string;
}

function cursorMismatches(match: CursorMatch): boolean {
  if (match.cursorTask !== match.taskId || match.consumed > match.offset) {
    return true;
  }

  return BigInt(match.afterId) > PG_BIGINT_MAX;
}

interface TurnScanStart {
  state: TurnScanState;
  afterId: string;
  sawTurns: boolean;
}

// Seeds the scan state from a validated resume cursor, or from scratch.
function initTurnScanState(
  resume: TurnResume | null,
  offset: number,
): TurnScanStart {
  const consumed = resume?.consumed ?? 0;
  const afterId = resume?.afterId ?? "0";

  return {
    state: {
      consumed,
      boundaryId: afterId,
      boundaryChars: consumed,
      slice: "",
      mustValidateResume: resume !== null && offset > consumed,
    },
    afterId,
    sawTurns: resume !== null,
  };
}

function turnSliceResult(
  taskId: string,
  state: TurnScanState,
  hasMore: boolean,
  sawTurns: boolean,
): TurnSlice {
  return {
    slice: state.slice,
    hasMore,
    sawTurns,
    cursor: `${taskId}:${state.boundaryId}:${state.boundaryChars}`,
  };
}

type TurnScanStep =
  | { kind: "restart" }
  | { kind: "done"; result: TurnSlice }
  | { kind: "continue"; afterId: string };

interface TurnScanPageContext {
  taskId: string;
  offset: number;
  sawTurns: boolean;
}

// Folds one fetched page into the scan, deciding whether the walk restarts, finishes, or continues.
function stepTurnScan(
  state: TurnScanState,
  page: Awaited<ReturnType<AgentRunTurnsRepository["listByTask"]>>,
  context: TurnScanPageContext,
): TurnScanStep {
  if (state.mustValidateResume && page.length === 0) {
    return { kind: "restart" };
  }
  const outcome = consumeTurnPage(state, page, context.offset);

  if (outcome === "restart") {
    return { kind: "restart" };
  }

  if (outcome === "sliced" || page.length < TURNS_PAGE_SIZE) {
    return {
      kind: "done",
      result: turnSliceResult(
        context.taskId,
        state,
        outcome === "sliced",
        context.sawTurns,
      ),
    };
  }

  return { kind: "continue", afterId: nextPageAfterId(page, state) };
}

function nextPageAfterId(
  page: Awaited<ReturnType<AgentRunTurnsRepository["listByTask"]>>,
  state: TurnScanState,
): string {
  const last = page.at(-1);

  return last ? last.id : state.boundaryId;
}

// Flattens turns to the UTF-16 slice [offset, offset+LOG_SLICE_MAX); `resume` seeks straight to the previous cursor's row boundary instead of re-paging the whole prefix (#1307) — a stale/forged offset past the boundary falls back to a full rescan from row id 0, while an at-boundary cursor is trusted as-is (bearer-scoped, so a forged skip only affects the forger's own read); a rewind below the boundary self-heals the same way.
async function readTurnSlice(
  turns: AgentRunTurnsRepository,
  taskId: string,
  offset: number,
  resume: TurnResume | null,
): Promise<TurnSlice> {
  const {
    state,
    afterId: startId,
    sawTurns: startSawTurns,
  } = initTurnScanState(resume, offset);
  let afterId = startId;
  let sawTurns = startSawTurns;

  for (;;) {
    const page = await turns.listByTask(taskId, afterId, TURNS_PAGE_SIZE);

    sawTurns = sawTurns || page.length > 0;

    const step = stepTurnScan(state, page, { taskId, offset, sawTurns });

    if (step.kind === "restart") {
      return readTurnSlice(turns, taskId, offset, null);
    }

    if (step.kind === "done") {
      return step.result;
    }
    afterId = step.afterId;
  }
}

interface TurnScanState {
  consumed: number;
  boundaryId: string;
  boundaryChars: number;
  slice: string;
  mustValidateResume: boolean;
}

type TurnRow = Awaited<
  ReturnType<AgentRunTurnsRepository["listByTask"]>
>[number];

function advanceBoundary(state: TurnScanState, row: TurnRow): void {
  state.boundaryId = row.id;
  state.boundaryChars = state.consumed;
}

// Consumes one row already known to end at or before the offset — advances past it without adding to the slice.
function skipRowBeforeOffset(
  state: TurnScanState,
  row: TurnRow,
  line: string,
): void {
  state.consumed += line.length;
  advanceBoundary(state, row);
}

// Appends the offset-relative piece of one row to the slice; "sliced" when the row didn't fit whole.
function appendRowToSlice(
  state: TurnScanState,
  row: TurnRow,
  line: string,
  offset: number,
): "sliced" | null {
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
  advanceBoundary(state, row);

  return null;
}

// Folds one row into the scan state: "restart" when the resume cursor proves stale, "sliced" when the slice budget is exhausted mid-row, else null.
function consumeTurnRow(
  state: TurnScanState,
  row: TurnRow,
  offset: number,
): "restart" | "sliced" | null {
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
    skipRowBeforeOffset(state, row, line);

    return null;
  }

  return appendRowToSlice(state, row, line, offset);
}

// Folds one page into the scan state: "restart" when the resume cursor proves stale, "sliced" when the slice budget is exhausted mid-page, else null.
function consumeTurnPage(
  state: TurnScanState,
  page: Awaited<ReturnType<AgentRunTurnsRepository["listByTask"]>>,
  offset: number,
): "restart" | "sliced" | null {
  for (const row of page) {
    const outcome = consumeTurnRow(state, row, offset);

    if (outcome) {
      return outcome;
    }
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
