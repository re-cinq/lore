import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../../../server/api-error.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { z } from "zod";
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { parseTrailers } from "@re-cinq/lore-shared";
import { getOctokit } from "../../../platform/github-client.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";

const LORE_TASK_TRAILER_RE = /^Lore-Task:\s*([0-9a-f-]+)\s*$/im;

/** Which task a PR belongs to, and where the trailer was found. */
const TaskByPrSchema = z.object({
  task_id: z.string(),
  trailer_source: z.enum(["db", "pr_body", "final_commit"]),
});

export function taskByPrRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/tasks/by-pr/{owner}/{repo}/{number}",
    options: zodResponse(bearerScope("read"), TaskByPrSchema, {
      name: "TaskByPr",
      description: "The task a pull request belongs to",
      errors: [404],
    }),
    handler: async (request, h) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), "database unavailable");

      const owner = request.params.owner;
      const repoName = request.params.repo;

      // hapi's `{number}` doesn't constrain to digits like the legacy matcher did — reject non-numeric here, not a confusing NaN downstream.
      enforceTrue(
        /^[0-9]+$/.test(request.params.number),
        apiError(400),
        "invalid pr number",
      );
      const prNumber = Number.parseInt(request.params.number, 10);
      const repo = `${owner}/${repoName}`;

      // First try the DB — fast path.
      try {
        const { rows } = await pool.query(
          `SELECT id FROM pipeline.tasks
             WHERE target_repo = $1 AND pr_number = $2
             LIMIT 1`,
          [repo, prNumber],
        );

        if (rows.length > 0) {
          return h.response({ task_id: rows[0].id, trailer_source: "db" });
        }
      } catch (err) {
        console.error("[by-pr] DB lookup failed:", err);
      }

      // Fall back to GitHub API: fetch PR body + final commit and parse for the Lore-Task: trailer.
      try {
        const octokit = await getOctokit();
        const pr = await octokit.rest.pulls.get({
          owner,
          repo: repoName,
          pull_number: prNumber,
        });

        const fromBody = pr.data.body?.match(LORE_TASK_TRAILER_RE);

        if (fromBody) {
          return h.response({
            task_id: fromBody[1],
            trailer_source: "pr_body",
          });
        }

        // Final commit on the PR head branch.
        const commit = await octokit.rest.git.getCommit({
          owner,
          repo: repoName,
          commit_sha: pr.data.head.sha,
        });
        const trailers = parseTrailers(commit.data.message);

        if (trailers?.taskId) {
          return h.response({
            task_id: trailers.taskId,
            trailer_source: "final_commit",
          });
        }

        return h.response({ error: "no_trailer_found" }).code(404);
      } catch (err) {
        enforceTrue(
          (err as { status?: number }).status !== 404,
          apiError(404),
          "pr_not_found",
        );
        console.error("[by-pr] GitHub fallback failed:", err);

        return h.response({ error: "github_api" }).code(500);
      }
    },
  };
}
