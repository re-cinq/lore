import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { repoFullName } from "../common-schemas.js";

const RepoStatusQuery = z.object({ repo: repoFullName.optional() });

type RepoStatusQuery = z.infer<typeof RepoStatusQuery>;

export function repoStatusRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/repo-status",
    options: {
      ...bearerScope("read"),
      validate: { query: zodValidate(RepoStatusQuery) },
    },
    handler: async (request, h) => {
      const pool = getPool();
      const { repo } = request.query as RepoStatusQuery;

      if (!repo || !pool) {
        return h.response({ onboarded: false });
      }

      try {
        const repoRow = await pool.query(
          `SELECT settings, last_ingested_at FROM lore.repos WHERE full_name = $1`,
          [repo],
        );

        if (repoRow.rows.length === 0) {
          return h.response({ onboarded: false, repo });
        }

        const settings = repoRow.rows[0].settings || {};
        const lastIngested = repoRow.rows[0].last_ingested_at || null;
        const running = await pool.query(
          `SELECT count(*) as c FROM pipeline.tasks WHERE target_repo = $1 AND status = 'running'`,
          [repo],
        );
        const prReady = await pool.query(
          `SELECT count(*) as c FROM pipeline.tasks WHERE target_repo = $1 AND status IN ('pr-created', 'review')`,
          [repo],
        );
        const memories = await pool.query(
          `SELECT count(*) as c FROM memory.memories WHERE is_deleted = false`,
        );
        const stale =
          !lastIngested ||
          Date.now() - new Date(lastIngested).getTime() > 7 * 86400000;

        return h.response({
          onboarded: true,
          repo,
          running: Number(running.rows[0]?.c || 0),
          pr_ready: Number(prReady.rows[0]?.c || 0),
          memories: Number(memories.rows[0]?.c || 0),
          auto_review: settings.auto_review === true,
          last_ingested_at: lastIngested,
          stale,
        });
      } catch (err: any) {
        console.error("[repo-status] Error:", err.message);

        return h.response({ onboarded: false, error: err.message });
      }
    },
  };
}
