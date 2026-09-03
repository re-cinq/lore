import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { getHealthStatus } from "@re-cinq/lore-server-core/platform/db.js";
import { validateClientToken } from "../auth.js";

const TASK_STATS_SQL = `SELECT count(*) FILTER (WHERE created_at > current_date)::int as today, count(*) FILTER (WHERE status = 'pending')::int as pending FROM pipeline.tasks`;

/** GET /healthz — liveness + readiness probe; auth optional for stats. */
export function healthzRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/healthz",
    options: { auth: false },
    handler: async (request, h) => {
      const pool = getPool();
      const health = await getHealthStatus();
      const status =
        health.connected || !process.env.LORE_DB_HOST ? "ok" : "error";
      const code = status === "error" ? 503 : 200;

      const authHeader = request.headers.authorization;
      const bearer = (
        Array.isArray(authHeader) ? authHeader[0] : authHeader
      )?.replace("Bearer ", "");
      const isAuthed = bearer
        ? await validateClientToken(pool, bearer, "read")
        : false;

      if (!isAuthed) {
        return h.response({ status }).code(code);
      }

      let tasks = { processed_today: 0, pending: 0 };

      if (health.connected && pool) {
        try {
          const stats = await pool.query(TASK_STATS_SQL);

          tasks = {
            processed_today: stats.rows[0]?.today || 0,
            pending: stats.rows[0]?.pending || 0,
          };
        } catch {
          /* non-fatal — fall back to zeroed stats */
        }
      }

      return h.response({ status, database: health, tasks }).code(code);
    },
  };
}
