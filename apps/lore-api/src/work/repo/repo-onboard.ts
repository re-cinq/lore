import type { Pool, PoolClient } from "pg";
import {
  createPipelineTask,
  decideOnboard,
  onboardLockKey,
  onboardTaskDescription,
  toOnboardState,
  IN_FLIGHT_TASK_STATUSES,
  ONBOARD_IN_FLIGHT_TASK_SQL,
  ONBOARD_REPO_STATE_SQL,
  type OnboardBlock,
  type OnboardDecision,
  type OnboardRepoRow,
  type OnboardState,
  type OnboardTaskRow,
} from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { selectList, fromRow } from "@re-cinq/lore-shared/lib/row.js";
import { REPO_COLUMNS, type Repo } from "@re-cinq/lore-shared/models/repo.js";

import { getOctokit } from "../../outbound/github-client.js";
import {
  ensureLoreWebhook,
  type EnsureLoreWebhookResult,
} from "../webhook/webhook-ensure.js";

// ── Installation repos ──────────────────────────────────────────────

export interface InstallationRepo {
  full_name: string;
  owner: string;
  name: string;
}

const INSTALLATION_PAGE_SIZE = 100;

/** Lists all repositories the GitHub App installation has access to. */
export async function getInstallationRepos(): Promise<InstallationRepo[]> {
  const { rest } = await getOctokit();
  const repos: InstallationRepo[] = [];

  for (let page = 1; ; page++) {
    const batch = await fetchInstallationPage(rest.apps, page);

    repos.push(...batch);

    if (batch.length < INSTALLATION_PAGE_SIZE) {
      break;
    }
  }

  return repos;
}

/** GitHub omits the owner login on some installation entries, so the full name is the fallback source for it. */
async function fetchInstallationPage(
  apps: Awaited<ReturnType<typeof getOctokit>>["rest"]["apps"],
  page: number,
): Promise<InstallationRepo[]> {
  const { data: listed } = await apps.listReposAccessibleToInstallation({
    per_page: INSTALLATION_PAGE_SIZE,
    page,
  });

  return listed.repositories.map(({ full_name, owner, name }) => ({
    full_name,
    owner: owner.login || full_name.split("/")[0],
    name,
  }));
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
    `SELECT ${selectList(REPO_COLUMNS)} FROM lore.repos ORDER BY onboarded_at DESC`,
  );

  return rows.map((row) => fromRow<Repo>(REPO_COLUMNS, row));
}

const TASK_COUNTS_SQL = `SELECT target_repo, COUNT(*) AS task_count,
        COUNT(DISTINCT agent_id) FILTER (WHERE status = 'running') AS active_agents
 FROM pipeline.tasks GROUP BY target_repo`;

const REPOS_WITH_COUNTS_SQL = `SELECT ${selectList(REPO_COLUMNS, "r")},
        COALESCE(tc.task_count, 0)::int AS task_count,
        COALESCE(tc.active_agents, 0)::int AS active_agents
 FROM lore.repos r
 LEFT JOIN (${TASK_COUNTS_SQL}) tc ON tc.target_repo = r.full_name
 ORDER BY r.onboarded_at DESC LIMIT $1 OFFSET $2`;

/** Returns a page of repos with pipeline task counts plus the unpaged total. */
export async function getOnboardedReposWithCounts(
  pool: Pool,
  limit = 100,
  offset = 0,
): Promise<{ repos: RepoWithCounts[]; total: number }> {
  const { rows } = await pool.query<Record<string, unknown>>(
    REPOS_WITH_COUNTS_SQL,
    [limit, offset],
  );
  const { rows: countRows } = await pool.query<{ total: number }>(
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
  webhook: EnsureLoreWebhookResult;
}

/** Returned instead of `OnboardResult` when the guard refuses the submission. */
export interface OnboardBlockedResult {
  blocked: OnboardBlock;
  error: string;
  /** The onboard task already in flight, when that is the reason. */
  task_id: string | null;
}

/** What the guarded transaction produced: the two ids, or the refusal. */
type OnboardWrite = { repoId: string; taskId: string } | OnboardBlockedResult;

interface RepoIdentity {
  fullName: string;
  owner: string;
  name: string;
}

/** Onboards a repo by inserting into lore.repos and submitting an onboard task; guarded against duplicates via per-repo advisory lock (#968). */
export async function onboardRepo(
  pool: Pool,
  fullName: string,
  options: { reonboard?: boolean } = {},
): Promise<OnboardResult | OnboardBlockedResult> {
  const written = await writeOnboardTx(pool, repoIdentity(fullName), options);

  if ("blocked" in written) {
    return written;
  }

  // Point the repo's GitHub webhook at the Floor ingress WITH the HMAC secret (best-effort).
  const webhook = await ensureLoreWebhook(fullName);

  logWebhookOutcome(webhook, fullName);

  return {
    repo_id: written.repoId,
    task_id: written.taskId,
    status: "onboarding-agent-spawned",
    webhook,
  };
}

/** Every downstream write keys on both halves, so a name that does not split is refused before any connection is taken. */
function repoIdentity(fullName: string): RepoIdentity {
  const [owner, name] = fullName.split("/");

  enforceTrue(
    !(!owner || !name),
    Error,
    `Invalid repo full_name: "${fullName}". Expected "owner/repo" format.`,
  );

  return { fullName, owner, name };
}

/** Runs the onboarding write on its own connection, rolling back anything the write left open. The rollback is unconditional on failure and swallowed: the connection is about to be released either way, and a failed rollback must not replace the error that caused it. */
async function writeOnboardTx(
  pool: Pool,
  identity: RepoIdentity,
  options: { reonboard?: boolean },
): Promise<OnboardWrite> {
  const client = await pool.connect();

  try {
    return await writeOnboard(client, identity, options);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Runs both writes (repos upsert + task) on ONE connection + transaction, holding per-repo advisory lock to avoid deadlocks and ensure atomicity. */
async function writeOnboard(
  client: PoolClient,
  { fullName, owner, name }: RepoIdentity,
  options: { reonboard?: boolean },
): Promise<OnboardWrite> {
  const decision = await beginAndDecide(client, fullName, options);

  if (!decision.allowed) {
    return refuseOnboard(client, fullName, decision);
  }
  const written = await insertRepoAndTask(client, { fullName, owner, name });

  await client.query("COMMIT");

  return written;
}

/** The advisory lock is taken INSIDE the transaction so it releases with it — two concurrent submissions for one repo must not both read a clear state. */
async function beginAndDecide(
  client: PoolClient,
  fullName: string,
  options: { reonboard?: boolean },
): Promise<OnboardDecision> {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    onboardLockKey(fullName),
  ]);
  const state = await readOnboardState(client, fullName);

  return decideOnboard(fullName, state, options);
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

/** The transaction is already open when a refusal lands, so the rollback belongs with the message that explains it. */
async function refuseOnboard(
  client: PoolClient,
  fullName: string,
  decision: Extract<OnboardDecision, { allowed: false }>,
): Promise<OnboardBlockedResult> {
  const { block, message, taskId } = decision;

  await client.query("ROLLBACK");
  console.log(`[onboard] Refused ${fullName} (${block}): ${message}`);

  return { blocked: block, error: message, task_id: taskId };
}

/** The repo row FIRST, then its task. The order is load-bearing: the task's trust gate reads that row, so a task created before it would be judged against a repo that does not exist yet. Re-onboarding refreshes the timestamp rather than inserting a second row. */
async function insertRepoAndTask(
  client: PoolClient,
  { fullName, owner, name }: RepoIdentity,
): Promise<OnboardWrite> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO lore.repos (owner, name, full_name) VALUES ($1, $2, $3)
       ON CONFLICT (full_name) DO UPDATE SET onboarded_at = now() RETURNING id`,
    [owner, name, fullName],
  );
  const task = await createPipelineTask(client, {
    description: onboardTaskDescription(fullName),
    taskType: "onboard",
    targetRepo: fullName,
    createdBy: "onboard-system",
    contextBundle: { repo: fullName },
  });

  return { repoId: rows[0].id, taskId: task.task_id };
}

/** Webhook wiring is best-effort — a skip is worth a warning, never a failure. */
function logWebhookOutcome(
  webhook: EnsureLoreWebhookResult,
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

export { fetchRepoContext, type RepoContext } from "./repo-onboard-context.js";
