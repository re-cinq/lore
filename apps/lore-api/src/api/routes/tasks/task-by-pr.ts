import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { parseTrailers } from "@re-cinq/lore-shared";
import { getOctokit } from "../../../platform/github-client.js";
import { json } from "../http.js";

const BY_PR_RE = /^\/api\/tasks\/by-pr\/([^/]+)\/([^/]+)\/([0-9]+)/;
const LORE_TASK_TRAILER_RE = /^Lore-Task:\s*([0-9a-f-]+)\s*$/im;

export async function handleTaskByPr(
  req: IncomingMessage,
  res: ServerResponse,
  pool: Pool | null,
): Promise<void> {
  if (!pool) {
    json(res, 503, { error: "database unavailable" });
    return;
  }
  // The dispatcher only routes here on a full BY_PR_RE match, so m is non-null.
  const m = req.url!.match(BY_PR_RE)!;
  const owner = decodeURIComponent(m[1]);
  const repoName = decodeURIComponent(m[2]);
  const prNumber = Number.parseInt(m[3], 10);
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
      json(res, 200, { task_id: rows[0].id, trailer_source: "db" });
      return;
    }
  } catch (err) {
    console.error("[by-pr] DB lookup failed:", err);
  }

  // Fall back to GitHub API: fetch PR body + final commit and parse
  // for Lore-Task: trailer.
  try {
    const octokit = await getOctokit();
    const pr = await octokit.rest.pulls.get({
      owner,
      repo: repoName,
      pull_number: prNumber,
    });

    const fromBody = pr.data.body?.match(LORE_TASK_TRAILER_RE);
    if (fromBody) {
      json(res, 200, { task_id: fromBody[1], trailer_source: "pr_body" });
      return;
    }

    // Final commit on the PR head branch.
    const head = pr.data.head.sha;
    const commit = await octokit.rest.git.getCommit({
      owner,
      repo: repoName,
      commit_sha: head,
    });
    const trailers = parseTrailers(commit.data.message);
    if (trailers?.taskId) {
      json(res, 200, {
        task_id: trailers.taskId,
        trailer_source: "final_commit",
      });
      return;
    }
    json(res, 404, { error: "no_trailer_found" });
  } catch (err) {
    if ((err as { status?: number }).status === 404) {
      json(res, 404, { error: "pr_not_found" });
      return;
    }
    console.error("[by-pr] GitHub fallback failed:", err);
    json(res, 500, { error: "github_api" });
  }
}
