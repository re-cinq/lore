import { errorMessage } from "@re-cinq/lore-shared";
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { repoFullName } from "../common-schemas.js";

const RepoStatusQuery = z.object({ repo: repoFullName.optional() });

type RepoStatusQuery = z.infer<typeof RepoStatusQuery>;

/** The statusline's read: onboarding state plus what the repo is doing now. */
const RepoStatusSchema = z.object({
  onboarded: z.boolean(),
  repo: z.string().optional(),
  running: z.number().optional(),
  pr_ready: z.number().optional(),
  memories: z.number().optional(),
  auto_review: z.boolean().optional(),
  last_ingested_at: z.string().nullable().optional(),
  /** True when the last ingest is older than seven days. */
  stale: z.boolean().optional(),
  error: z.string().optional(),
});

const STALE_AFTER_MS = 7 * 86400000;

function rowCount(result: { rows: Array<{ c?: string | number }> }): number {
  return Number(result.rows[0]?.c ?? 0);
}

function isStale(lastIngested: string | null): boolean {
  if (!lastIngested) {
    return true;
  }

  return Date.now() - new Date(lastIngested).getTime() > STALE_AFTER_MS;
}

function parseRepoRow(row: {
  settings: { auto_review?: boolean } | null;
  last_ingested_at: string | null;
}): { settings: { auto_review?: boolean }; lastIngested: string | null } {
  return {
    settings: row.settings || {},
    lastIngested: row.last_ingested_at || null,
  };
}

async function repoActivity(pool: Pool, repo: string) {
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

  return {
    running: rowCount(running),
    pr_ready: rowCount(prReady),
    memories: rowCount(memories),
  };
}

export function repoStatusRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/repo-status",
    options: zodResponse(
      {
        ...bearerScope("read"),
        validate: { query: zodValidate(RepoStatusQuery) },
      },
      RepoStatusSchema,
      {
        name: "RepoStatus",
        description: "Onboarding state and current activity for a repo",
      },
    ),
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

        const { settings, lastIngested } = parseRepoRow(repoRow.rows[0]);
        const activity = await repoActivity(pool, repo);

        return h.response({
          onboarded: true,
          repo,
          ...activity,
          auto_review: settings.auto_review === true,
          last_ingested_at: lastIngested,
          stale: isStale(lastIngested),
        });
      } catch (err) {
        console.error("[repo-status] Error:", errorMessage(err));

        return h.response({ onboarded: false, error: errorMessage(err) });
      }
    },
  };
}
