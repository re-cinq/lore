import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { getHealthStatus } from "@re-cinq/lore-server-core/platform/db.js";
import { json } from "../http.js";
import { validateClientToken } from "../auth.js";

export async function handleHealthz(req: IncomingMessage, res: ServerResponse, pool: Pool | null): Promise<void> {
  const health = await getHealthStatus();
  const status = health.connected || !process.env.LORE_DB_HOST ? "ok" : "error";
  const code = status === "error" ? 503 : 200;
  const bearer = req.headers.authorization?.replace("Bearer ", "");
  const isAuthed = bearer ? await validateClientToken(pool, bearer, "read") : false;
  if (isAuthed) {
    let tasks = { processed_today: 0, pending: 0 };
    if (health.connected && pool) {
      try {
        const taskStats = await pool.query(`SELECT count(*) FILTER (WHERE created_at > current_date)::int as today, count(*) FILTER (WHERE status = 'pending')::int as pending FROM pipeline.tasks`);
        tasks = { processed_today: taskStats.rows[0]?.today || 0, pending: taskStats.rows[0]?.pending || 0 };
      } catch { /* non-fatal */ }
    }
    json(res, code, { status, database: health, tasks });
  } else {
    json(res, code, { status });
  }
}
