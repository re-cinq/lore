import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { parseTrailers } from "@re-cinq/lore-shared";
import { getOctokit } from "../../../platform/github-client.js";
import { json } from "../http.js";

const TIMELINE_RE = /^\/api\/tasks\/([^/?]+)\/timeline/;

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

/**
 * Fold the raw GitHub commit list (most-recent-first) into the ordered
 * stage-commit timeline. Pure: takes plain commits + the task start time,
 * returns the timeline with per-stage durations. Only commits carrying
 * Lore stage trailers contribute.
 */
export function buildTimeline(commitsApi: RawCommit[], createdAt: Date): TimelineCommit[] {
  // Stage commits are most-recent-first from GitHub. Reverse for
  // chronological order so durations compute correctly.
  const ordered = [...commitsApi].reverse();
  const stageCommits: TimelineCommit[] = [];
  let prevTimeMs = createdAt.getTime();
  for (const c of ordered) {
    const trailers = parseTrailers(c.commit.message);
    if (!trailers) continue;
    const committedIso =
      c.commit.committer?.date ?? new Date().toISOString();
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

export async function handleTaskTimeline(
  req: IncomingMessage,
  res: ServerResponse,
  pool: Pool | null,
): Promise<void> {
  if (!pool) {
    json(res, 503, { error: "database unavailable" });
    return;
  }
  const m = req.url!.match(TIMELINE_RE);
  if (!m) {
    json(res, 404, { error: "not found" });
    return;
  }
  const taskId = decodeURIComponent(m[1]);

  let task: {
    target_repo: string | null;
    target_branch: string | null;
    pr_number: number | null;
    pr_url: string | null;
    status: string;
    created_at: Date;
  } | undefined;
  try {
    const { rows } = await pool.query(
      `SELECT target_repo, target_branch, pr_number, pr_url, status, created_at
         FROM pipeline.tasks WHERE id = $1`,
      [taskId],
    );
    task = rows[0];
  } catch (err) {
    console.error("[timeline] task lookup failed:", err);
    json(res, 500, { error: "internal" });
    return;
  }
  if (!task) {
    json(res, 404, { error: "task_not_found" });
    return;
  }

  const repo = task.target_repo;
  const branch = task.target_branch;
  if (!repo || !branch) {
    json(res, 200, {
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
    return;
  }

  // Fetch commits via the GitHub API. Avoids requiring a local git checkout —
  // the branch is the source of truth on the remote anyway.
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
      json(res, 200, {
        task_id: taskId,
        branch_name: branch,
        repo,
        pr_number: task.pr_number,
        pr_url: task.pr_url,
        pr_state: null,
        commits: [],
        branch_deleted: true,
      });
      return;
    }
    console.error("[timeline] listCommits failed:", err);
    json(res, 500, { error: "github_api" });
    return;
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
    const { rows } = await pool.query(
      `SELECT holder, expires_at FROM pipeline.task_leases WHERE branch_name = $1`,
      [branch],
    );
    if (rows.length > 0) {
      const expiresAt = new Date(rows[0].expires_at);
      lease = {
        held: expiresAt.getTime() > Date.now(),
        holder: rows[0].holder,
        expires_at: expiresAt.toISOString(),
      };
    } else {
      lease = { held: false };
    }
  } catch {
    // Lease table may not exist yet — non-fatal.
  }

  json(res, 200, {
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
}
