import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../../../server/api-error.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { z } from "zod";
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { parseTrailers } from "@re-cinq/lore-shared";
import { getOctokit } from "../../../platform/github-client.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";

export interface TimelineCommit {
  sha: string;
  stage: string;
  iteration: number;
  outcome: string;
  committed_at: string;
  duration_ms: number | null;
  summary: string;
  extras?: Record<string, string>;
}

interface RawCommit {
  sha: string;
  commit: { message: string; committer: { date?: string | null } | null };
}

// Folds the raw GitHub commit list (most-recent-first) into the ordered stage-commit timeline; only commits carrying Lore stage trailers contribute.
/** The branch-as-state view: what each stage committed, and who holds the lease. */
const TaskTimelineSchema = z.object({
  task_id: z.string(),
  branch_name: z.string().nullable(),
  repo: z.string().nullable(),
  pr_number: z.number().nullable(),
  pr_url: z.string().nullable(),
  pr_state: z.string().nullable(),
  commits: z.array(z.record(z.unknown())),
  current_stage: z.string().nullable(),
  lease: z.record(z.unknown()).nullable().optional(),
});

export function buildTimeline(
  commitsApi: RawCommit[],
  createdAt: Date,
): TimelineCommit[] {
  // Stage commits are most-recent-first from GitHub — reverse for chronological order so durations compute correctly.
  const ordered = [...commitsApi].reverse();
  const stageCommits: TimelineCommit[] = [];
  let prevTimeMs = createdAt.getTime();

  for (const c of ordered) {
    const trailers = parseTrailers(c.commit.message);

    if (!trailers) {
      continue;
    }
    const committedIso = c.commit.committer?.date ?? new Date().toISOString();
    const committedMs = new Date(committedIso).getTime();

    stageCommits.push({
      sha: c.sha,
      stage: trailers.stage,
      iteration: trailers.iteration,
      outcome: trailers.extras?.["Lore-Outcome"] ?? "success",
      committed_at: committedIso,
      duration_ms: Number.isFinite(committedMs - prevTimeMs)
        ? committedMs - prevTimeMs
        : null,
      summary: c.commit.message.split("\n")[0],
      ...(trailers.extras ? { extras: trailers.extras } : {}),
    });
    prevTimeMs = committedMs;
  }

  return stageCommits;
}

/** Wire shape of a held-or-lapsed lease row; `held` reflects the clock, not the row's existence. */
function leaseFromRow(row: { holder: string; expires_at: string }): {
  held: boolean;
  holder?: string;
  expires_at?: string;
} {
  const expiresAt = new Date(row.expires_at);

  return {
    held: expiresAt.getTime() > Date.now(),
    holder: row.holder,
    expires_at: expiresAt.toISOString(),
  };
}

export function timelineRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/tasks/{id}/timeline",
    options: zodResponse(bearerScope("read"), TaskTimelineSchema, {
      name: "TaskTimeline",
      description: "A task's stage commits and lease",
      errors: [404],
    }),
    handler: async (request, h) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), "database unavailable");
      const taskId = request.params.id;
      const task = await readTaskRow(pool, taskId);

      enforceTrue(task, apiError(404), "task_not_found");
      const base = {
        task_id: taskId,
        branch_name: task.target_branch,
        repo: task.target_repo,
        pr_number: task.pr_number,
        pr_url: task.pr_url,
      };

      // A task with no branch has no timeline to read — that is pending work, not an error.
      if (!task.target_repo || !task.target_branch) {
        return h.response({
          ...base,
          pr_state: null,
          commits: [],
          current_stage: null,
          pending: "no_branch",
        });
      }
      const history = await readBranchHistory(
        task.target_repo,
        task.target_branch,
        task.pr_number,
      );

      if (history === "branch-deleted") {
        return h.response({
          ...base,
          pr_state: null,
          commits: [],
          branch_deleted: true,
        });
      }

      enforceTrue(history !== "github-error", apiError(500), "github_api");
      const commits = buildTimeline(history.commits, task.created_at);

      return h.response({
        ...base,
        pr_state: history.prState,
        commits,
        current_stage: commits.at(-1)?.stage ?? null,
        lease: await readLease(pool, task.target_branch),
      });
    },
  };
}

interface TimelineTaskRow {
  target_repo: string | null;
  target_branch: string | null;
  pr_number: number | null;
  pr_url: string | null;
  status: string;
  created_at: Date;
}

/** The task row the timeline is built around. A failed read is reported as 503-shaped `internal` by the caller's enforce, never as "no such task". */
async function readTaskRow(
  pool: Pool,
  taskId: string,
): Promise<TimelineTaskRow | undefined> {
  const { rows } = await pool.query<TimelineTaskRow>(
    `SELECT target_repo, target_branch, pr_number, pr_url, status, created_at
             FROM pipeline.tasks WHERE id = $1`,
    [taskId],
  );

  return rows[0];
}

/** Read through the GitHub API rather than a checkout — the branch is the remote source of truth, and this service holds no clone. A 404 means the branch is gone, which the caller reports rather than treating as failure. */
async function readBranchHistory(
  repo: string,
  branch: string,
  prNumber: number | null,
): Promise<
  | { commits: RawCommit[]; prState: "open" | "closed" | "merged" | null }
  | "branch-deleted"
  | "github-error"
> {
  try {
    const [owner, repoName] = repo.split("/");
    const octokit = await getOctokit();
    const r = await octokit.rest.repos.listCommits({
      owner,
      repo: repoName,
      sha: branch,
      per_page: 100,
    });

    return {
      commits: r.data as RawCommit[],
      prState: prNumber
        ? await readPrState(octokit, owner, repoName, prNumber)
        : null,
    };
  } catch (err) {
    if ((err as { status?: number }).status === 404) {
      return "branch-deleted";
    }
    console.error("[timeline] listCommits failed:", err);

    return "github-error";
  }
}

/** Best-effort: the commits are the timeline, and a PR whose state cannot be read still has one. */
async function readPrState(
  octokit: Awaited<ReturnType<typeof getOctokit>>,
  owner: string,
  repo: string,
  pull_number: number,
): Promise<"open" | "closed" | "merged" | null> {
  try {
    const res = await octokit.rest.pulls.get({ owner, repo, pull_number });

    return res.data.merged ? "merged" : (res.data.state as "open" | "closed");
  } catch {
    return null;
  }
}

/** Best-effort: the lease table is migration-gated, and a timeline without it is still a timeline. */
async function readLease(
  pool: Pool,
  branch: string,
): Promise<{ held: boolean; holder?: string; expires_at?: string } | null> {
  try {
    const { rows } = await pool.query<{ holder: string; expires_at: string }>(
      `SELECT holder, expires_at FROM pipeline.task_leases WHERE branch_name = $1`,
      [branch],
    );

    return rows.length > 0 ? leaseFromRow(rows[0]) : { held: false };
  } catch {
    return null;
  }
}
