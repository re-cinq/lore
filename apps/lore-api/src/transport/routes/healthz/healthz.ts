import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import {
  getHealthStatus,
  embeddingHealth,
  embedderDegraded,
} from "@re-cinq/lore-server-core/platform/db.js";
import { validateClientToken } from "../../http/auth.js";

const TASK_STATS_SQL = `SELECT count(*) FILTER (WHERE created_at > current_date)::int as today, count(*) FILTER (WHERE status = 'pending')::int as pending FROM pipeline.tasks`;

const ZERO_TASKS = { processed_today: 0, pending: 0 };

/** GET /healthz — liveness + readiness probe; auth optional for stats. */
export function healthzRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/healthz",
    options: { auth: false },
    handler: (request, h) => serveHealthz(getPool, request, h),
  };
}

/** Liveness plus, for a reader-scoped caller, the task counters. */
async function serveHealthz(
  getPool: () => Pool | null,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const pool = getPool();
  const health = await getHealthStatus();
  const { status, code } = healthResponseStatus(health);
  const body = (await isReaderAuthed(pool, request))
    ? await fullHealth(pool, health, status)
    : { status };

  return h.response(body).code(code);
}

// `degraded` stays 200: the pod serves, but every hybrid source is ranking keyword-only. The 403 outage of 2026-08-13 → 09-09 ran four weeks because nothing but a log line said so.
function healthResponseStatus({ connected }: { connected: boolean }): {
  status: "ok" | "degraded" | "error";
  code: number;
} {
  if (!connected && process.env.LORE_DB_HOST) {
    return { status: "error", code: 503 };
  }

  return { status: embedderDegraded() ? "degraded" : "ok", code: 200 };
}

async function isReaderAuthed(
  pool: Pool | null,
  request: Request,
): Promise<boolean> {
  const bearer = bearerToken(request.headers.authorization);

  return bearer ? validateClientToken(pool, bearer, "read") : false;
}

function bearerToken(
  authHeader: string | string[] | undefined,
): string | undefined {
  const header = Array.isArray(authHeader) ? authHeader[0] : authHeader;

  return header?.replace("Bearer ", "");
}

type DbHealth = Awaited<ReturnType<typeof getHealthStatus>>;

async function fullHealth(
  pool: Pool | null,
  health: DbHealth,
  status: string,
): Promise<Record<string, unknown>> {
  const tasks =
    health.connected && pool ? await fetchTaskStats(pool) : ZERO_TASKS;

  return { status, database: health, embeddings: embeddingHealth(), tasks };
}

async function fetchTaskStats(
  pool: Pool,
): Promise<{ processed_today: number; pending: number }> {
  try {
    const { rows } = await pool.query(TASK_STATS_SQL);
    const row = rows[0] ?? {};

    return { processed_today: row.today ?? 0, pending: row.pending ?? 0 };
  } catch {
    return ZERO_TASKS;
  }
}
