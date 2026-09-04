import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { getHealthStatus } from "@re-cinq/lore-server-core/platform/db.js";
import { validateClientToken } from "../auth.js";

const TASK_STATS_SQL = `SELECT count(*) FILTER (WHERE created_at > current_date)::int as today, count(*) FILTER (WHERE status = 'pending')::int as pending FROM pipeline.tasks`;

const ZERO_TASKS = { processed_today: 0, pending: 0 };

function bearerToken(
  authHeader: string | string[] | undefined,
): string | undefined {
  const header = Array.isArray(authHeader) ? authHeader[0] : authHeader;

  return header?.replace("Bearer ", "");
}

function healthResponseStatus(connected: boolean): {
  status: "ok" | "error";
  code: number;
} {
  const status = connected || !process.env.LORE_DB_HOST ? "ok" : "error";

  return { status, code: status === "error" ? 503 : 200 };
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

/** GET /healthz — liveness + readiness probe; auth optional for stats. */
export function healthzRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/healthz",
    options: { auth: false },
    handler: async (request, h) => {
      const pool = getPool();
      const health = await getHealthStatus();
      const { status, code } = healthResponseStatus(health.connected);
      const bearer = bearerToken(request.headers.authorization);
      const isAuthed = bearer
        ? await validateClientToken(pool, bearer, "read")
        : false;

      if (!isAuthed) {
        return h.response({ status }).code(code);
      }

      const tasks =
        health.connected && pool ? await fetchTaskStats(pool) : ZERO_TASKS;

      return h.response({ status, database: health, tasks }).code(code);
    },
  };
}
