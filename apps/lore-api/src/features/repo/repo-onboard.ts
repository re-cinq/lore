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
/**
 * Repo onboarding module.
 *
 * Lists repos the GitHub App can access, compares against lore.repos,
 * and submits onboarding tasks to the Lore Agent pipeline so an agent can
 * inspect the repo and generate customized CLAUDE.md / onboarding PRs.
 */

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

/**
 * Lists all repositories the GitHub App installation has access to.
 */
export async function getInstallationRepos(): Promise<InstallationRepo[]> {
  const octokit = await getOctokit();
  const repos: InstallationRepo[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const { data } = await octokit.rest.apps.listReposAccessibleToInstallation({
      per_page: perPage,
      page,
    });

    for (const repo of data.repositories) {
      repos.push({
        full_name: repo.full_name,
        owner: repo.owner?.login || repo.full_name.split("/")[0],
        name: repo.name,
      });
    }

    if (data.repositories.length < perPage) {
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

/**
 * Returns all repos from lore.repos.
 */
export async function getOnboardedRepos(pool: Pool): Promise<Repo[]> {
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT ${selectList(REPO_COLUMNS)}
     FROM lore.repos
     ORDER BY onboarded_at DESC`,
  );

  return rows.map((row) => fromRow<Repo>(REPO_COLUMNS, row));
}

/**
 * Returns a page of repos with pipeline task counts plus the unpaged total.
 */
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

/**
 * Returns installation repos that are NOT yet in lore.repos.
 */
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
  /** Outcome of pointing the repo's GitHub webhook at the Floor ingress (with
   *  the HMAC secret). Best-effort — a skip never fails onboarding. */
  webhook: EnsureFloorWebhookResult;
}

/** Returned instead of `OnboardResult` when the guard refuses the submission. */
export interface OnboardBlockedResult {
  blocked: OnboardBlock;
  error: string;
  /** The onboard task already in flight, when that is the reason. */
  task_id: string | null;
}

/**
 * Reads the repo's onboarding state on `client`, which must already hold the
 * per-repo advisory lock so the read cannot go stale before the write.
 */
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

/**
 * Runs the guard and, when it clears, both writes — the `lore.repos` upsert and
 * the onboard task — inside ONE transaction on ONE connection, holding the
 * per-repo advisory lock throughout.
 *
 * Both properties matter. Sharing the connection keeps a single onboard from
 * needing two pooled connections at once, which would deadlock the pool once
 * concurrent submissions reach its size (every waiter holds a connection while
 * blocked on the lock). Sharing the transaction keeps the failure truthful: a
 * task committed on its own connection could outlive a rolled-back repos row
 * and then block every retry as "in flight".
 */
async function writeOnboard(
  client: PoolClient,
  fullName: string,
  owner: string,
  name: string,
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

  // Upsert first: the task's trust gate reads this row, and re-onboarding
  // refreshes the timestamp.
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

/**
 * Onboards a repo by inserting it into lore.repos and submitting an
 * "onboard" task to the Lore Agent pipeline. The agent will inspect the repo,
 * understand its tech stack, and generate a customized CLAUDE.md plus
 * supporting files — then open a single onboarding PR.
 *
 * Guarded: an already-onboarded repo, one with an onboarding PR still open, or
 * one with an onboard task in flight is refused rather than given a second task
 * (each task files its own Issue and races its own PR — see issue #968). Pass
 * `reonboard` for the deliberate repair path, which may run against an
 * onboarded repo but never against one still mid-onboarding. The read and both
 * writes share one transaction holding a per-repo advisory lock, so concurrent
 * submissions produce at most one task and a failure queues nothing.
 */
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
    written = await writeOnboard(client, fullName, owner, name, options);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  if ("blocked" in written) {
    return written;
  }

  // Point the repo's GitHub webhook at the Floor ingress WITH the HMAC secret so
  // events flow once the App is installed — without it, deliveries 401. Best-effort:
  // a missing secret/host or a lacking App permission is reported, never fatal.
  const webhook = await ensureFloorWebhook(fullName);

  if (webhook.ok) {
    console.log(
      `[onboard] Webhook ${webhook.created ? "created" : "updated"} for ${fullName} (hook ${webhook.hookId})`,
    );
  } else {
    console.warn(
      `[onboard] Webhook not configured for ${fullName}: ${webhook.reason}${webhook.detail ? ` (${webhook.detail})` : ""}`,
    );
  }

  return {
    repo_id: written.repoId,
    task_id: written.taskId,
    status: "onboarding-agent-spawned",
    webhook,
  };
}

// ── Fetch repo context for onboarding agents ────────────────────────

export interface RepoContext {
  tree: string[]; // list of top-level file/dir names
  files: Record<string, string>; // path -> content for key files
  samples: Record<string, string>; // path -> first 200 lines of sampled source files
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

/**
 * Decodes base64-encoded file content returned by the GitHub API.
 */
function decodeContent(encoded: string): string {
  return Buffer.from(encoded, "base64").toString("utf-8");
}

/**
 * Fetches contextual information about a repo: top-level tree, key config
 * files, and a sample of source files from well-known directories.
 * Used by onboarding agents to understand a repo's tech stack.
 */
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
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: "",
    });

    if (Array.isArray(data)) {
      tree = data.map((entry) => entry.name);
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
        const { data } = await octokit.rest.repos.getContent({
          owner,
          repo,
          path,
        });

        if (!Array.isArray(data) && data.type === "file" && data.content) {
          files[path] = decodeContent(data.content);
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
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: dir,
      });

      if (Array.isArray(data)) {
        entries = data.filter((e) => e.type === "file");
      }
    } catch (err) {
      if ((err as { status?: number }).status !== 404) {
        console.error(
          `[onboard] Error listing ${fullName}/${dir}: ${errorMessage(err)}`,
        );
      }
      continue;
    }

    for (const entry of entries) {
      if (Object.keys(samples).length >= 3) {
        break;
      }

      try {
        const { data } = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: entry.path,
        });

        if (!Array.isArray(data) && data.type === "file" && data.content) {
          const full = decodeContent(data.content);
          const first200 = full.split("\n").slice(0, 200).join("\n");

          samples[entry.path] = first200;
        }
      } catch (err) {
        console.error(
          `[onboard] Error fetching sample ${fullName}/${entry.path}: ${errorMessage(err)}`,
        );
      }
    }
  }

  return { tree, files, samples };
}

// ── Onboarding PR merge detection (T018) ────────────────────────────

/**
 * Checks all repos with unmerged onboarding PRs. When a PR is found to
 * be merged, flips onboarding_pr_merged to true and sets last_ingested_at
 * so the nightly CronJob picks it up for initial ingestion (T019).
 */
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

        await createTask(
          `Initial ingestion for ${repo.full_name}: read CLAUDE.md, ADRs, runbooks, code structure`,
          "general",
          repo.full_name,
          "onboard-ingest",
        );
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
