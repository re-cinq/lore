import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { json } from "../http.js";

export async function handleRepoStatus(req: IncomingMessage, res: ServerResponse, pool: Pool | null): Promise<void> {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const repo = url.searchParams.get("repo");
  console.log(`[repo-status] repo=${repo} dbPoolRef=${!!pool}`);
  if (!repo || !pool) {
    json(res, 200, { onboarded: false });
    return;
  }
  try {
    const repoRow = await pool.query(`SELECT settings, last_ingested_at FROM lore.repos WHERE full_name = $1`, [repo]);
    if (repoRow.rows.length === 0) {
      json(res, 200, { onboarded: false, repo });
      return;
    }
    const settings = repoRow.rows[0].settings || {};
    const lastIngested = repoRow.rows[0].last_ingested_at || null;
    const running = await pool.query(
      `SELECT count(*) as c FROM pipeline.tasks WHERE target_repo = $1 AND status = 'running'`, [repo],
    );
    const prReady = await pool.query(
      `SELECT count(*) as c FROM pipeline.tasks WHERE target_repo = $1 AND status IN ('pr-created', 'review')`, [repo],
    );
    const memories = await pool.query(`SELECT count(*) as c FROM memory.memories WHERE is_deleted = false`);
    const stale = !lastIngested || (Date.now() - new Date(lastIngested).getTime() > 7 * 86400000);
    json(res, 200, {
      onboarded: true, repo,
      running: Number(running.rows[0]?.c || 0),
      pr_ready: Number(prReady.rows[0]?.c || 0),
      memories: Number(memories.rows[0]?.c || 0),
      auto_review: settings.auto_review === true,
      last_ingested_at: lastIngested,
      stale,
    });
  } catch (err: any) {
    console.error("[repo-status] Error:", err.message);
    json(res, 200, { onboarded: false, error: err.message });
  }
}
