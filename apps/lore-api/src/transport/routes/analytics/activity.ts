import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { z } from "zod";
import { selectList, pickColumns } from "@re-cinq/lore-shared/lib/row.js";
import { wireSchema } from "@re-cinq/lore-shared/lib/wire-schema.js";
import {
  MemoryAuditEntrySchema,
  MEMORY_AUDIT_ENTRY_COLUMNS,
} from "@re-cinq/lore-shared/models/memory-audit-entry.js";
import {
  EventSchema,
  EVENT_COLUMNS,
} from "@re-cinq/lore-shared/models/event.js";
import {
  JobRunSchema,
  JOB_RUN_COLUMNS,
} from "@re-cinq/lore-shared/models/job-run.js";
import { zodResponse } from "../../http/zod-response.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodValidate } from "../../http/zod-validate.js";
import { clampedLimit, offsetParam, optionalBool } from "../common-schemas.js";
import { withPool } from "../with-pool.js";

// Activity reads behind the audit/gaps/events/job-run views, moved out of web-ui (ADR-032); one file since all three are the same shape of paged read.

const UNDEFINED_TABLE = "42P01";

const missingTable = (err: unknown) =>
  (err as { code?: string }).code === UNDEFINED_TABLE;

const MemoryAuditQuery = z.object({
  agent: z.string().max(200).optional(),
  operation: z.string().max(40).optional(),
  // The gap view's lens: filter server-side, or paging in Node would page over the wrong set.
  zero_results: optionalBool,
  limit: clampedLimit.default(50),
  offset: offsetParam,
});

type MemoryAuditQuery = z.infer<typeof MemoryAuditQuery>;

const EventsQuery = z.object({
  repo: z.string().min(1).max(200),
  limit: clampedLimit.default(20),
  offset: offsetParam,
});

type EventsQuery = z.infer<typeof EventsQuery>;

// A dashboard count that must never take its page down: an absent table or failed count reports null.
async function countOrNull(
  pool: Pool,
  sql: string,
  params: unknown[],
): Promise<number | null> {
  try {
    const { rows } = await pool.query<{ c: number }>(sql, params);

    return rows[0]?.c ?? null;
  } catch {
    return null;
  }
}

// Each response body is DERIVED from its model + column map via wireSchema, so the contract and the table state the same fields.
const EVENT_BROWSE_FIELDS = [
  "id",
  "eventName",
  "source",
  "params",
  "status",
  "capturedAt",
] as const;
const EVENT_BROWSE_COLUMNS = pickColumns(EVENT_COLUMNS, EVENT_BROWSE_FIELDS);

const MemoryAuditPageSchema = z.object({
  entries: z.array(
    wireSchema(MemoryAuditEntrySchema, MEMORY_AUDIT_ENTRY_COLUMNS),
  ),
  total: z.number(),
});

const EventListSchema = z.object({
  events: z.array(
    wireSchema(
      EventSchema.pick({
        id: true,
        eventName: true,
        source: true,
        params: true,
        status: true,
        capturedAt: true,
      }),
      EVENT_COLUMNS,
    ),
  ),
});

// Seven-day activity counters; each is NULL (not zero) when its table is absent, so "unknown" is distinguishable from "a quiet week".
const ActivityCountsSchema = z.object({
  tasks: z.number().nullable(),
  auto_merged: z.number().nullable(),
  escalations: z.number().nullable(),
});

const JobRunReadSchema = wireSchema(JobRunSchema, JOB_RUN_COLUMNS);

const TASKS_7D_SQL = `SELECT count(*)::int as c FROM pipeline.tasks
        WHERE target_repo = $1 AND created_at >= now() - interval '7 days'`;

const AUTO_MERGED_7D_SQL = `SELECT count(*)::int as c FROM pipeline.audit_log
        WHERE repo = $1
          AND event_type = 'auto_merge_decision'
          AND payload->>'outcome' = 'merged'
          AND created_at >= now() - interval '7 days'`;

const ESCALATIONS_7D_SQL = `SELECT count(*)::int as c FROM pipeline.audit_log
        WHERE repo = $1
          AND event_type = 'escalation_issued'
          AND created_at >= now() - interval '7 days'`;

export function activityRoutes(getPool: () => Pool | null): ServerRoute[] {
  return [
    memoryAuditRoute(getPool),
    eventsRoute(getPool),
    jobRunRoute(getPool),
    activityCountsRoute(getPool),
  ];
}

/** A page of memory-audit entries — who wrote or read which memory, which is the only record of an agent touching org-wide state. */
async function serveMemoryAudit(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const query = request.query as unknown as MemoryAuditQuery;

  return h.response(await memoryAuditPage(pool, query));
}

/** The filtered count and the filtered page, read through one WHERE clause so the total can never describe a different set than the rows. */
async function memoryAuditPage(pool: Pool, query: MemoryAuditQuery) {
  const { where, params } = memoryAuditFilter(query);
  const { rows: countRows } = await pool.query<{ count: number }>(
    `SELECT count(*)::int as count FROM memory.audit_log ${where}`,
    params,
  );
  const { rows: entries } = await pool.query(
    `SELECT ${selectList(MEMORY_AUDIT_ENTRY_COLUMNS)}
       FROM memory.audit_log
       ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, query.limit, query.offset],
  );

  return { entries, total: countRows[0]?.count ?? 0 };
}

function memoryAuditRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/memory-audit",
    options: zodResponse(
      {
        ...bearerScope("read"),
        validate: { query: zodValidate(MemoryAuditQuery) },
      },
      MemoryAuditPageSchema,
      {
        name: "MemoryAuditPage",
        description: "A page of memory-audit entries",
      },
    ),
    handler: withPool(getPool, serveMemoryAudit),
  };
}

function trimmedOrUndefined(value?: string): string | undefined {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

function whereClause(conditions: string[]): string {
  return conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
}

/** The optional filters, as a WHERE clause and its positional params — built once so the count and the page cannot disagree about what is being filtered. */
function memoryAuditFilter(query: MemoryAuditQuery): {
  where: string;
  params: unknown[];
} {
  const conditions: string[] = [];
  const params: unknown[] = [];

  pushEquals({ conditions, params, column: "agent_id", value: query.agent });
  pushEquals({
    conditions,
    params,
    column: "operation",
    value: query.operation,
  });

  if (query.zero_results) {
    conditions.push(`metadata->>'result_count' = '0'`);
  }

  return { where: whereClause(conditions), params };
}

/** Appends one `column = $n` equality, skipping a blank value, so the positional index and the condition are always allocated together. */
function pushEquals(clause: {
  conditions: string[];
  params: unknown[];
  column: string;
  value?: string;
}): void {
  const trimmed = trimmedOrUndefined(clause.value);

  if (!trimmed) {
    return;
  }
  const { conditions, params } = clause;

  params.push(trimmed);
  conditions.push(`${clause.column} = $${params.length}`);
}

/** A repo's recent bus events, newest first: what the Floor was asked to do, and in which order. */
async function serveRepoEvents(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const query = request.query as unknown as EventsQuery;

  try {
    return h.response({ events: await repoEventRows(pool, query) });
  } catch (err) {
    if (missingTable(err)) {
      return h.response({ events: [] });
    }

    throw err;
  }
}

async function repoEventRows(pool: Pool, { repo, limit, offset }: EventsQuery) {
  const { rows } = await pool.query(
    `SELECT ${selectList(EVENT_BROWSE_COLUMNS)}
       FROM pipeline.events
      WHERE repo = $1
      ORDER BY captured_at DESC
      LIMIT $2 OFFSET $3`,
    [repo, limit, offset],
  );

  return rows;
}

function eventsRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/events",
    options: zodResponse(
      {
        ...bearerScope("read"),
        validate: { query: zodValidate(EventsQuery) },
      },
      EventListSchema,
      { name: "RepoEventList", description: "A repo's recent events" },
    ),
    handler: withPool(getPool, serveRepoEvents),
  };
}

function jobRunRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/job-runs/{id}",
    options: zodResponse(bearerScope("read"), JobRunReadSchema, {
      name: "JobRun",
      description: "One scheduled-job run",
      errors: [404],
    }),
    handler: withPool(getPool, serveJobRun),
  };
}

async function serveJobRun(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const { rows } = await pool.query(
    `SELECT ${selectList(JOB_RUN_COLUMNS)}
       FROM pipeline.job_runs WHERE id = $1`,
    [request.params.id],
  );

  return rows.length > 0
    ? h.response(rows[0])
    : h.response({ error: "Job run not found" }).code(404);
}

/** Seven-day counters for a repo — the numbers the dashboard tiles read, computed here rather than client-side so every caller counts the same way. */
/** The three seven-day counters. Auto-merges and escalations are counted from the AUDIT log rather than from task status: a task can be merged by a human after the machine deferred, and only the audit row says which happened. */
async function sevenDayCounts(pool: Pool, repo: string) {
  return {
    tasks: await countOrNull(pool, TASKS_7D_SQL, [repo]),
    auto_merged: await countOrNull(pool, AUTO_MERGED_7D_SQL, [repo]),
    escalations: await countOrNull(pool, ESCALATIONS_7D_SQL, [repo]),
  };
}

async function serveActivityCounts(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const repo = `${request.params.owner}/${request.params.repo}`;

  return h.response(await sevenDayCounts(pool, repo));
}

function activityCountsRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/activity-counts",
    options: zodResponse(bearerScope("read"), ActivityCountsSchema, {
      name: "RepoActivityCounts",
      description: "Seven-day activity counters for a repo",
    }),
    handler: withPool(getPool, serveActivityCounts),
  };
}
