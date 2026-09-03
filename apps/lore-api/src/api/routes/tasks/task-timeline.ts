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

      let task:
        | {
            target_repo: string | null;
            target_branch: string | null;
            pr_number: number | null;
            pr_url: string | null;
            status: string;
            created_at: Date;
          }
        | undefined;

      try {
        const { rows } = await pool.query(
          `SELECT target_repo, target_branch, pr_number, pr_url, status, created_at
             FROM pipeline.tasks WHERE id = $1`,
          [taskId],
        );

        task = rows[0];
      } catch (err) {
        console.error("[timeline] task lookup failed:", err);

        return h.response({ error: "internal" }).code(500);
      }

      enforceTrue(task, apiError(404), "task_not_found");

      const repo = task.target_repo;
      const branch = task.target_branch;

      if (!repo || !branch) {
        return h.response({
          task_id: taskId,
          branch_name: branch,
          repo,
          pr_number: task.pr_number,
          pr_url: task.pr_url,
          pr_state: null,
          commits: [],
          current_stage: null,
          pending: "no_branch",
        });
      }

      // Fetch commits via the GitHub API — avoids requiring a local checkout since the branch is the remote source of truth.
      let commitsApi: RawCommit[];
      let prState: "open" | "closed" | "merged" | null = null;

      try {
        const [owner, repoName] = repo.split("/");
        const octokit = await getOctokit();
        const r = await octokit.rest.repos.listCommits({
          owner,
          repo: repoName,
          sha: branch,
          per_page: 100,
        });

        commitsApi = r.data as RawCommit[];

        if (task.pr_number) {
          try {
            const prRes = await octokit.rest.pulls.get({
              owner,
              repo: repoName,
              pull_number: task.pr_number,
            });

            prState = prRes.data.merged
              ? "merged"
              : (prRes.data.state as "open" | "closed");
          } catch {
            // PR fetch is best-effort.
          }
        }
      } catch (err) {
        if ((err as { status?: number }).status === 404) {
          return h.response({
            task_id: taskId,
            branch_name: branch,
            repo,
            pr_number: task.pr_number,
            pr_url: task.pr_url,
            pr_state: null,
            commits: [],
            branch_deleted: true,
          });
        }
        console.error("[timeline] listCommits failed:", err);

        return h.response({ error: "github_api" }).code(500);
      }

      const stageCommits = buildTimeline(commitsApi, task.created_at);
      const currentStage =
        stageCommits.length > 0
          ? stageCommits[stageCommits.length - 1].stage
          : null;

      // Lease state — best-effort.
      let lease: {
        held: boolean;
        holder?: string;
        expires_at?: string;
      } | null = null;

      try {
        const { rows } = await pool.query<{
          holder: string;
          expires_at: string;
        }>(
          `SELECT holder, expires_at FROM pipeline.task_leases WHERE branch_name = $1`,
          [branch],
        );

        lease = rows.length > 0 ? leaseFromRow(rows[0]) : { held: false };
      } catch {
        // Lease table may not exist yet — non-fatal.
      }

      return h.response({
        task_id: taskId,
        branch_name: branch,
        repo,
        pr_number: task.pr_number,
        pr_url: task.pr_url,
        pr_state: prState,
        commits: stageCommits,
        current_stage: currentStage,
        lease,
      });
    },
  };
}
