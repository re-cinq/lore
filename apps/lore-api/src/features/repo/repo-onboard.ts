import type { Pool, PoolClient } from "pg";
import {
  createPipelineTask,
  decideOnboard,
  errorMessage,
  onboardLockKey,
  onboardTaskDescription,
  toOnboardState,
  IN_FLIGHT_TASK_STATUSES,
  ONBOARD_IN_FLIGHT_TASK_SQL,
  ONBOARD_REPO_STATE_SQL,
  type OnboardBlock,
  type OnboardRepoRow,
  type OnboardState,
  type OnboardTaskRow,
} from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { selectList, fromRow } from "@re-cinq/lore-shared/lib/row.js";
import { REPO_COLUMNS, type Repo } from "@re-cinq/lore-shared/models/repo.js";

import { getOctokit } from "../../platform/github-client.js";
import {
  ensureFloorWebhook,
  type EnsureFloorWebhookResult,
} from "../webhook/webhook-ensure.js";

// ── Installation repos ──────────────────────────────────────────────

export interface InstallationRepo {
  full_name: string;
  owner: string;
  name: string;
}

/** Lists all repositories the GitHub App installation has access to. */
export async function getInstallationRepos(): Promise<InstallationRepo[]> {
  const octokit = await getOctokit();
  const repos: InstallationRepo[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const { data: installed } =
      await octokit.rest.apps.listReposAccessibleToInstallation({
        per_page: perPage,
        page,
      });

    repos.push(
      ...installed.repositories.map((repo) => ({
        full_name: repo.full_name,
        owner: repo.owner?.login || repo.full_name.split("/")[0],
        name: repo.name,
      })),
    );

    if (installed.repositories.length < perPage) {
      break;
    }
    page++;
  }

  return repos;
}

// ── Database queries ────────────────────────────────────────────────

/** A `lore.repos` row plus the pipeline counts the repo list renders beside it. */
export interface RepoWithCounts extends Repo {
  taskCount: number;
  activeAgents: number;
}

/** Returns all repos from lore.repos. */
export async function getOnboardedRepos(pool: Pool): Promise<Repo[]> {
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT ${selectList(REPO_COLUMNS)}
     FROM lore.repos
     ORDER BY onboarded_at DESC`,
  );

  return rows.map((row) => fromRow<Repo>(REPO_COLUMNS, row));
}

/** Returns a page of repos with pipeline task counts plus the unpaged total. */
export async function getOnboardedReposWithCounts(
  pool: Pool,
  limit = 100,
  offset = 0,
): Promise<{ repos: RepoWithCounts[]; total: number }> {
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT ${selectList(REPO_COLUMNS, "r")},
            COALESCE(tc.task_count, 0)::int AS task_count,
            COALESCE(tc.active_agents, 0)::int AS active_agents
     FROM lore.repos r
     LEFT JOIN (
       SELECT target_repo, COUNT(*) AS task_count,
              COUNT(DISTINCT agent_id) FILTER (WHERE status = 'running') AS active_agents
       FROM pipeline.tasks
       GROUP BY target_repo
     ) tc ON tc.target_repo = r.full_name
     ORDER BY r.onboarded_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  const { rows: countRows } = await pool.query(
    `SELECT count(*)::int as total FROM lore.repos`,
  );

  const repos = rows.map((row) => ({
    ...fromRow<Repo>(REPO_COLUMNS, row),
    taskCount: row.task_count as number,
    activeAgents: row.active_agents as number,
  }));

  return { repos, total: countRows[0].total };
}

/** Returns installation repos that are NOT yet in lore.repos. */
export async function getAvailableRepos(
  pool: Pool,
): Promise<InstallationRepo[]> {
  const [installation, onboarded] = await Promise.all([
    getInstallationRepos(),
    getOnboardedRepos(pool),
  ]);

  const onboardedSet = new Set(onboarded.map((r) => r.fullName));

  return installation.filter((r) => !onboardedSet.has(r.full_name));
}

// ── Onboard a repo ──────────────────────────────────────────────────

export interface OnboardResult {
  repo_id: string;
  task_id: string;
  status: string;
  /** Outcome of pointing the repo's GitHub webhook at the Floor ingress (with HMAC secret). */
  webhook: EnsureFloorWebhookResult;
}

/** Returned instead of `OnboardResult` when the guard refuses the submission. */
export interface OnboardBlockedResult {
  blocked: OnboardBlock;
  error: string;
  /** The onboard task already in flight, when that is the reason. */
  task_id: string | null;
}

/** Reads the repo's onboarding state on `client`, which must already hold the per-repo advisory lock. */
async function readOnboardState(
  client: PoolClient,
  fullName: string,
): Promise<OnboardState> {
  const { rows: repoRows } = await client.query<OnboardRepoRow>(
    ONBOARD_REPO_STATE_SQL,
    [fullName],
  );
  const { rows: taskRows } = await client.query<OnboardTaskRow>(
    ONBOARD_IN_FLIGHT_TASK_SQL,
    [fullName, [...IN_FLIGHT_TASK_STATUSES]],
  );

  return toOnboardState(repoRows[0], taskRows[0]);
}

/** What the guarded transaction produced: the two ids, or the refusal. */
type OnboardWrite = { repoId: string; taskId: string } | OnboardBlockedResult;

/** Runs both writes (repos upsert + task) on ONE connection + transaction, holding per-repo advisory lock to avoid deadlocks and ensure atomicity. */
interface RepoIdentity {
  fullName: string;
  owner: string;
  name: string;
}

async function writeOnboard(
  client: PoolClient,
  { fullName, owner, name }: RepoIdentity,
  options: { reonboard?: boolean },
): Promise<OnboardWrite> {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    onboardLockKey(fullName),
  ]);

  const decision = decideOnboard(
    fullName,
    await readOnboardState(client, fullName),
    options,
  );

  if (!decision.allowed) {
    await client.query("ROLLBACK");
    console.log(
      `[onboard] Refused ${fullName} (${decision.block}): ${decision.message}`,
    );

    return {
      blocked: decision.block,
      error: decision.message,
      task_id: decision.taskId,
    };
  }

  // Upsert first so task's trust gate reads this row; re-onboarding refreshes timestamp.
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO lore.repos (owner, name, full_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (full_name) DO UPDATE SET onboarded_at = now()
       RETURNING id`,
    [owner, name, fullName],
  );
  const task = await createPipelineTask(client, {
    description: onboardTaskDescription(fullName),
    taskType: "onboard",
    targetRepo: fullName,
    createdBy: "onboard-system",
    contextBundle: { repo: fullName },
  });

  await client.query("COMMIT");

  return { repoId: rows[0].id, taskId: task.task_id };
}

/** Webhook wiring is best-effort — a skip is worth a warning, never a failure. */
function logWebhookOutcome(
  webhook: EnsureFloorWebhookResult,
  fullName: string,
): void {
  if (webhook.ok) {
    console.log(
      `[onboard] Webhook ${webhook.created ? "created" : "updated"} for ${fullName} (hook ${webhook.hookId})`,
    );

    return;
  }
  console.warn(
    `[onboard] Webhook not configured for ${fullName}: ${webhook.reason}${webhook.detail ? ` (${webhook.detail})` : ""}`,
  );
}

/** Onboards a repo by inserting into lore.repos and submitting an onboard task; guarded against duplicates via per-repo advisory lock (#968). */
export async function onboardRepo(
  pool: Pool,
  fullName: string,
  options: { reonboard?: boolean } = {},
): Promise<OnboardResult | OnboardBlockedResult> {
  const [owner, name] = fullName.split("/");

  enforceTrue(
    !(!owner || !name),
    Error,
    `Invalid repo full_name: "${fullName}". Expected "owner/repo" format.`,
  );

  const client = await pool.connect();
  let written: OnboardWrite;

  try {
    written = await writeOnboard(client, { fullName, owner, name }, options);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  if ("blocked" in written) {
    return written;
  }

  // Point the repo's GitHub webhook at the Floor ingress WITH the HMAC secret (best-effort).
  const webhook = await ensureFloorWebhook(fullName);

  logWebhookOutcome(webhook, fullName);

  return {
    repo_id: written.repoId,
    task_id: written.taskId,
    status: "onboarding-agent-spawned",
    webhook,
  };
}

// ── Fetch repo context for onboarding agents ────────────────────────

export interface RepoContext {
  tree: string[];
  files: Record<string, string>;
  samples: Record<string, string>;
}

const KEY_FILES = [
  "README.md",
  "CLAUDE.md",
  "AGENTS.md",
  "package.json",
  "go.mod",
  "Cargo.toml",
  "requirements.txt",
  "Dockerfile",
  "docker-compose.yml",
  "pom.xml",
  "Makefile",
  "tsconfig.json",
  "pyproject.toml",
];

const SAMPLE_DIRS = ["src", "lib", "cmd", "internal", "app", "pkg"];

/** Decodes base64-encoded file content returned by the GitHub API. */
function decodeContent(encoded: string): string {
  return Buffer.from(encoded, "base64").toString("utf-8");
}

/** Fetches repo context (tree, key files, source samples) for onboarding agents to understand tech stack. */
export async function fetchRepoContext(fullName: string): Promise<RepoContext> {
  const [owner, repo] = fullName.split("/");

  enforceTrue(
    !(!owner || !repo),
    Error,
    `Invalid repo full_name: "${fullName}". Expected "owner/repo" format.`,
  );

  const octokit = await getOctokit();

  // 1. Fetch top-level tree
  let tree: string[] = [];

  try {
    const { data: content } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: "",
    });

    if (Array.isArray(content)) {
      tree = content.map((entry) => entry.name);
    }
  } catch (err) {
    console.error(
      `[onboard] Failed to fetch tree for ${fullName}: ${errorMessage(err)}`,
    );
  }

  // 2. Fetch key files (skip 404s)
  const files: Record<string, string> = {};

  await Promise.all(
    KEY_FILES.map(async (path) => {
      try {
        const { data: content } = await octokit.rest.repos.getContent({
          owner,
          repo,
          path,
        });

        if (
          !Array.isArray(content) &&
          content.type === "file" &&
          content.content
        ) {
          files[path] = decodeContent(content.content);
        }
      } catch (err) {
        if ((err as { status?: number }).status !== 404) {
          console.error(
            `[onboard] Error fetching ${fullName}/${path}: ${errorMessage(err)}`,
          );
        }
      }
    }),
  );

  // 3. Sample up to 3 source files from key directories
  const samples: Record<string, string> = {};

  for (const dir of SAMPLE_DIRS) {
    if (Object.keys(samples).length >= 3) {
      break;
    }

    let entries: Array<{ name: string; path: string; type: string }> = [];

    try {
      const { data: content } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: dir,
      });

      if (Array.isArray(content)) {
        entries = content.filter((e) => e.type === "file");
      }
    } catch (err) {
      if ((err as { status?: number }).status !== 404) {
        console.error(
          `[onboard] Error listing ${fullName}/${dir}: ${errorMessage(err)}`,
        );
      }
      continue;
    }

    await sampleSourceFiles(
      octokit,
      { owner, repo, fullName },
      entries,
      samples,
    );
  }

  return { tree, files, samples };
}

interface SampledRepoRef {
  owner: string;
  repo: string;
  fullName: string;
}

/** Fills `samples` (up to 3 entries) with the first 200 lines of each listed file. */
async function sampleSourceFiles(
  octokit: Awaited<ReturnType<typeof getOctokit>>,
  ref: SampledRepoRef,
  entries: Array<{ name: string; path: string; type: string }>,
  samples: Record<string, string>,
): Promise<void> {
  for (const entry of entries) {
    if (Object.keys(samples).length >= 3) {
      break;
    }

    try {
      const { data: content } = await octokit.rest.repos.getContent({
        owner: ref.owner,
        repo: ref.repo,
        path: entry.path,
      });

      if (
        !Array.isArray(content) &&
        content.type === "file" &&
        content.content
      ) {
        const full = decodeContent(content.content);
        const first200 = full.split("\n").slice(0, 200).join("\n");

        samples[entry.path] = first200;
      }
    } catch (err) {
      console.error(
        `[onboard] Error fetching sample ${ref.fullName}/${entry.path}: ${errorMessage(err)}`,
      );
    }
  }
}

// ── Onboarding PR merge detection (T018) ────────────────────────────

/** Checks all repos with unmerged onboarding PRs; marks merged PRs for nightly ingestion (T019). */
export async function checkOnboardingPRs(pool: Pool): Promise<void> {
  const { rows } = await pool.query(
    `SELECT id, full_name, onboarding_pr_url FROM lore.repos
     WHERE onboarding_pr_merged = false AND onboarding_pr_url IS NOT NULL`,
  );

  for (const repo of rows) {
    try {
      // Extract PR number from URL
      const match = repo.onboarding_pr_url.match(/\/pull\/(\d+)/);

      if (!match) {
        continue;
      }
      const prNumber = parseInt(match[1]);
      const [owner, name] = repo.full_name.split("/");

      // Check PR status via GitHub API
      const octokit = await getOctokit();
      const { data: pr } = await octokit.rest.pulls.get({
        owner,
        repo: name,
        pull_number: prNumber,
      });

      if (pr.merged) {
        await pool.query(
          `UPDATE lore.repos SET onboarding_pr_merged = true, last_ingested_at = now() WHERE id = $1`,
          [repo.id],
        );
        // Trigger initial ingestion via pipeline
        const { createTask } =
          await import("@re-cinq/lore-server-core/features/pipeline/pipeline.js");

        await createTask({
          description: `Initial ingestion for ${repo.full_name}: read CLAUDE.md, ADRs, runbooks, code structure`,
          taskType: "general",
          targetRepo: repo.full_name,
          createdBy: "onboard-ingest",
        });
        console.log(
          `[repo-onboard] Onboarding PR merged for ${repo.full_name}, ingestion triggered`,
        );
      }
    } catch (err) {
      console.error(
        `[repo-onboard] Error checking PR for ${repo.full_name}: ${errorMessage(err)}`,
      );
    }
  }
}
