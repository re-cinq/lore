import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../../../server/api-error.js";
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
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
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import {
  clampedLimit,
  offsetParam,
  DB_UNAVAILABLE,
} from "../common-schemas.js";

// Activity reads behind the audit/gaps/events/job-run views, moved out of web-ui (ADR-032); one file since all three are the same shape of paged read.

const UNDEFINED_TABLE = "42P01";

const missingTable = (err: unknown) =>
  (err as { code?: string }).code === UNDEFINED_TABLE;

const MemoryAuditQuery = z.object({
  agent: z.string().max(200).optional(),
  operation: z.string().max(40).optional(),
  // The gap view's lens: filter server-side, or paging in Node would page over the wrong set.
  zero_results: z.coerce.boolean().optional(),
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

export function activityRoutes(getPool: () => Pool | null): ServerRoute[] {
  return [
    {
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
      handler: async (request, h) => {
        const pool = getPool();

        enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
        const { agent, operation, zero_results, limit, offset } =
          request.query as unknown as MemoryAuditQuery;

        const conditions: string[] = [];
        const params: unknown[] = [];

        if (agent?.trim()) {
          params.push(agent.trim());
          conditions.push(`agent_id = $${params.length}`);
        }

        if (operation?.trim()) {
          params.push(operation.trim());
          conditions.push(`operation = $${params.length}`);
        }

        if (zero_results) {
          conditions.push(`metadata->>'result_count' = '0'`);
        }
        const where = conditions.length
          ? `WHERE ${conditions.join(" AND ")}`
          : "";

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
          [...params, limit, offset],
        );

        return h.response({ entries, total: countRows[0]?.count ?? 0 });
      },
    },

    {
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
      handler: async (request, h) => {
        const pool = getPool();

        enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
        const { repo, limit, offset } = request.query as unknown as EventsQuery;

        try {
          const { rows } = await pool.query(
            `SELECT ${selectList(EVENT_BROWSE_COLUMNS)}
               FROM pipeline.events
              WHERE repo = $1
              ORDER BY captured_at DESC
              LIMIT $2 OFFSET $3`,
            [repo, limit, offset],
          );

          return h.response({ events: rows });
        } catch (err) {
          if (missingTable(err)) {
            return h.response({ events: [] });
          }

          throw err;
        }
      },
    },

    {
      method: "GET",
      path: "/api/job-runs/{id}",
      options: zodResponse(bearerScope("read"), JobRunReadSchema, {
        name: "JobRun",
        description: "One scheduled-job run",
        errors: [404],
      }),
      handler: async (request, h) => {
        const pool = getPool();

        enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
        const { rows } = await pool.query(
          `SELECT ${selectList(JOB_RUN_COLUMNS)}
             FROM pipeline.job_runs WHERE id = $1`,
          [request.params.id],
        );

        return rows.length > 0
          ? h.response(rows[0])
          : h.response({ error: "Job run not found" }).code(404);
      },
    },

    {
      method: "GET",
      path: "/api/repos/{owner}/{repo}/activity-counts",
      options: zodResponse(bearerScope("read"), ActivityCountsSchema, {
        name: "RepoActivityCounts",
        description: "Seven-day activity counters for a repo",
      }),
      handler: async (request, h) => {
        const pool = getPool();

        enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
        const repo = `${request.params.owner}/${request.params.repo}`;

        return h.response({
          tasks: await countOrNull(
            pool,
            `SELECT count(*)::int as c FROM pipeline.tasks
              WHERE target_repo = $1 AND created_at >= now() - interval '7 days'`,
            [repo],
          ),
          auto_merged: await countOrNull(
            pool,
            `SELECT count(*)::int as c FROM pipeline.audit_log
              WHERE repo = $1
                AND event_type = 'auto_merge_decision'
                AND payload->>'outcome' = 'merged'
                AND created_at >= now() - interval '7 days'`,
            [repo],
          ),
          escalations: await countOrNull(
            pool,
            `SELECT count(*)::int as c FROM pipeline.audit_log
              WHERE repo = $1
                AND event_type = 'escalation_issued'
                AND created_at >= now() - interval '7 days'`,
            [repo],
          ),
        });
      },
    },
  ];
}
