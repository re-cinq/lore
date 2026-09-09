import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { zodResponse } from "../../http/zod-response.js";
import { z } from "zod";
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { parseTrailers } from "@re-cinq/lore-shared";
import type { WireOf } from "@re-cinq/lore-shared/lib/wire-schema.js";
import {
  PipelineTaskSchema,
  PIPELINE_TASK_COLUMNS,
} from "@re-cinq/lore-shared/models/pipeline-task.js";
import { getOctokit } from "../../../outbound/github-client.js";
import { bearerScope } from "../../http/bearer-scope.js";

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
  commits: z.array(z.record(z.string(), z.unknown())),
  current_stage: z.string().nullable(),
  lease: z.record(z.string(), z.unknown()).nullable().optional(),
});

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

      return h.response(await taskTimeline(pool, request.params.id));
    },
  };
}

async function taskTimeline(
  pool: Pool,
  taskId: string,
): Promise<Record<string, unknown>> {
  const task = await readTaskRow(pool, taskId);

  enforceTrue(task, apiError(404), "task_not_found");
  const base = timelineBase(taskId, task);

  if (!task.target_repo || !task.target_branch) {
    return pendingTimeline(base);
  }
  const branch = { repo: task.target_repo, name: task.target_branch };

  return { ...base, ...(await branchTimeline(pool, task, branch)) };
}

// The pipeline.tasks fields the timeline is built around, picked from its wire contract.
type TimelineTaskRow = Pick<
  WireOf<typeof PipelineTaskSchema.shape, typeof PIPELINE_TASK_COLUMNS>,
  | "target_repo"
  | "target_branch"
  | "pr_number"
  | "pr_url"
  | "status"
  | "created_at"
>;

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

/** The identity half of the response, shared by every timeline outcome. */
function timelineBase(
  taskId: string,
  task: TimelineTaskRow,
): Record<string, unknown> {
  return {
    task_id: taskId,
    branch_name: task.target_branch,
    repo: task.target_repo,
    pr_number: task.pr_number,
    pr_url: task.pr_url,
  };
}

// A task with no branch yet is PENDING, not empty: it has not failed to produce commits, it has not started.
function pendingTimeline(
  base: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...base,
    pr_state: null,
    commits: [],
    current_stage: null,
    pending: "no_branch",
  };
}

/** Two of the three outcomes are not errors: a task with no branch yet has no timeline to read, and a deleted branch is a merged or abandoned one. Only GitHub failing is a 500. */
/** The timeline from the branch's own history. A DELETED branch is reported as such rather than as an empty timeline — the work happened, and saying "no commits" would read as the task having done nothing. */
async function branchTimeline(
  pool: Pool,
  task: TimelineTaskRow,
  branch: { repo: string; name: string },
): Promise<Record<string, unknown>> {
  const history = await readBranchHistory(
    branch.repo,
    branch.name,
    task.pr_number,
  );

  if (history === "branch-deleted") {
    return { pr_state: null, commits: [], branch_deleted: true };
  }

  enforceTrue(history !== "github-error", apiError(500), "github_api");

  return historyView(pool, history, branch.name, task.created_at);
}

/** What a branch read can answer: its history, or one of the two ways there is no history to report. Both non-answers are values rather than throws — the caller reports each of them differently, and neither is a failure of this service. */
interface BranchCommits {
  commits: RawCommit[];
  prState: "open" | "closed" | "merged" | null;
}

type BranchHistory = BranchCommits | "branch-deleted" | "github-error";

/** Read through the GitHub API rather than a checkout — the branch is the remote source of truth, and this service holds no clone. A 404 means the branch is gone, which the caller reports rather than treating as failure. */
async function readBranchHistory(
  repo: string,
  branch: string,
  prNumber: number | null,
): Promise<BranchHistory> {
  try {
    return await fetchBranchHistory(repo, branch, prNumber);
  } catch (err) {
    if ((err as { status?: number }).status === 404) {
      return "branch-deleted";
    }
    console.error("[timeline] listCommits failed:", err);

    return "github-error";
  }
}

/** The happy path of a branch read, left to throw so its caller owns every way it can fail. */
async function fetchBranchHistory(
  repo: string,
  branch: string,
  prNumber: number | null,
): Promise<BranchCommits> {
  const [owner, repoName] = repo.split("/");
  const { repos, pulls } = (await getOctokit()).rest;
  const target = { owner, repo: repoName, branch };
  const commits = await listBranchCommits(repos, target);

  return {
    commits,
    prState: prNumber
      ? await readPrState(pulls, owner, repoName, prNumber)
      : null,
  };
}

/** The branch's commits, newest first, capped at one page. A hundred is far more than a task's own history — a longer branch has been reused, and its earlier commits belong to work this timeline is not describing. */
async function listBranchCommits(
  repos: Awaited<ReturnType<typeof getOctokit>>["rest"]["repos"],
  target: { owner: string; repo: string; branch: string },
): Promise<RawCommit[]> {
  const r = await repos.listCommits({
    owner: target.owner,
    repo: target.repo,
    sha: target.branch,
    per_page: 100,
  });

  return r.data as RawCommit[];
}

/** Best-effort: the commits are the timeline, and a PR whose state cannot be read still has one. */
async function readPrState(
  pulls: Awaited<ReturnType<typeof getOctokit>>["rest"]["pulls"],
  owner: string,
  repo: string,
  pull_number: number,
): Promise<"open" | "closed" | "merged" | null> {
  try {
    const res = await pulls.get({ owner, repo, pull_number });

    return res.data.merged ? "merged" : (res.data.state as "open" | "closed");
  } catch {
    return null;
  }
}

/** The lease is read last: it says whether anyone holds the branch right now, which only matters once there are commits to hold. */
async function historyView(
  pool: Pool,
  history: BranchCommits,
  branchName: string,
  createdAt: Date,
): Promise<Record<string, unknown>> {
  const commits = buildTimeline(history.commits, createdAt);

  return {
    pr_state: history.prState,
    commits,
    current_stage: commits.at(-1)?.stage ?? null,
    lease: await readLease(pool, branchName),
  };
}

export function buildTimeline(
  commitsApi: RawCommit[],
  createdAt: Date,
): TimelineCommit[] {
  // Stage commits are most-recent-first from GitHub — reverse for chronological order so durations compute correctly.
  const ordered = [...commitsApi].reverse();
  const stageCommits: TimelineCommit[] = [];
  let prevTimeMs = createdAt.getTime();

  for (const c of ordered) {
    const stageCommit = buildStageCommit(c, prevTimeMs);

    if (!stageCommit) {
      continue;
    }
    stageCommits.push(stageCommit);
    prevTimeMs = new Date(stageCommit.committed_at).getTime();
  }

  return stageCommits;
}

/** One stage commit, or `null` when the commit carries no Lore trailers. */
function buildStageCommit(
  c: RawCommit,
  prevTimeMs: number,
): TimelineCommit | null {
  const { message } = c.commit;
  const trailers = parseTrailers(message);

  return trailers ? stageCommitOf(c, trailers, prevTimeMs) : null;
}

/** The wire shape of a commit already known to carry Lore trailers. */
function stageCommitOf(
  c: RawCommit,
  trailers: NonNullable<ReturnType<typeof parseTrailers>>,
  prevTimeMs: number,
): TimelineCommit {
  const { message } = c.commit;
  const committedIso = committedIsoOf(c);
  const committedMs = new Date(committedIso).getTime();

  return {
    sha: c.sha,
    stage: trailers.stage,
    iteration: trailers.iteration,
    outcome: outcomeOf(trailers),
    committed_at: committedIso,
    duration_ms: durationSince(committedMs, prevTimeMs),
    summary: message.split("\n")[0],
    ...extrasField(trailers),
  };
}

function committedIsoOf(c: RawCommit): string {
  const { committer } = c.commit;

  return committer?.date ?? new Date().toISOString();
}

function outcomeOf(
  trailers: NonNullable<ReturnType<typeof parseTrailers>>,
): string {
  return trailers.extras?.["Lore-Outcome"] ?? "success";
}

function durationSince(committedMs: number, prevTimeMs: number): number | null {
  const delta = committedMs - prevTimeMs;

  return Number.isFinite(delta) ? delta : null;
}

function extrasField(
  trailers: NonNullable<ReturnType<typeof parseTrailers>>,
): Pick<TimelineCommit, "extras"> {
  return trailers.extras ? { extras: trailers.extras } : {};
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
