/**
 * PR-state → AutoMergePolicyInputs lookup, shared between the in-agent
 * orchestrator (gap-fill / runbook retrospective handler) and the
 * loretask-watcher (cluster-path impl / general / review). Same
 * function, two callers — keeping the policy build in one place
 * prevents drift in the gates that decide which dark-mode PRs
 * auto-merge.
 *
 * Also hosts `buildOctokit` because PR-state lookups need an Octokit
 * and there's no other shared spot for it. Mirrors github.ts's auth
 * pattern but accepts both the GitHub App triplet and a fallback
 * `GITHUB_TOKEN` so the watcher (which today doesn't always run with
 * the App env wired) can still authenticate.
 */
import { Octokit } from "octokit";
import { createAppAuth } from "@octokit/auth-app";
import type { ResolvedDarkFactorySettings } from "@re-cinq/lore-shared";
import { query } from "../db.js";

export interface PrForAutoMerge {
  repo: string;
  prNumber: number;
  octokit: Octokit;
  policy: {
    darkFactoryEnabled: boolean;
    autoMerge: {
      paths: string[];
      min_trust: "docs" | "tests" | "implementation" | "full";
      require_green_ci: boolean;
      require_bot_approval: boolean;
    };
    trustLevel: "docs" | "tests" | "implementation" | "full" | undefined;
    changedPaths: string[];
    ciSucceeded: boolean;
    botApproved: boolean;
    humanChangesRequested: boolean;
  };
}

export function buildOctokit(): Octokit {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID;
  if (appId && privateKey && installationId) {
    return new Octokit({
      authStrategy: createAppAuth,
      auth: { appId, privateKey, installationId },
    });
  }
  if (process.env.GITHUB_TOKEN) {
    return new Octokit({ auth: process.env.GITHUB_TOKEN });
  }
  throw new Error(
    "GitHub not configured: set GITHUB_APP_* or GITHUB_TOKEN to use auto-merge",
  );
}

/**
 * Look up everything `evaluateAndMerge` needs by task id. Returns
 * null if the task has no PR yet (auto-merge has nothing to act on).
 *
 * Conservative defaults: assumes CI hasn't passed and the bot hasn't
 * approved until proven otherwise. Flipping these to `true` as the
 * initial state would let auto-merge fire when GitHub returns no
 * check_runs / reviews (a brand-new PR) — exactly when we most need
 * the gate.
 */
export async function resolvePrForTaskFromDb(
  taskId: string,
  settings: ResolvedDarkFactorySettings,
  octokit: Octokit,
): Promise<PrForAutoMerge | null> {
  const rows = await query<{
    pr_number: number | null;
    target_repo: string | null;
    target_branch: string | null;
  }>(
    `SELECT pr_number, target_repo, target_branch
       FROM pipeline.tasks WHERE id = $1`,
    [taskId],
  );
  const row = rows[0];
  if (!row?.pr_number || !row.target_repo) return null;

  const [owner, repoName] = row.target_repo.split("/");
  let ciSucceeded = false;
  let botApproved = false;
  let humanChangesRequested = false;
  let changedPaths: string[] = [];
  // Specific bot login the auto-merge gate trusts. Defaults to the
  // Lore agent App; deployments using a different App slug override
  // via env. Without this, *any* bot's APPROVED review (Dependabot,
  // Renovate, an external review bot) would satisfy the
  // require_bot_approval gate.
  const botLogin = process.env.LORE_REVIEW_BOT_LOGIN ?? "lore-agent[bot]";
  try {
    const filesRes = await octokit.rest.pulls.listFiles({
      owner,
      repo: repoName,
      pull_number: row.pr_number,
    });
    changedPaths = filesRes.data.map((f) => f.filename);

    const checks = await octokit.rest.checks.listForRef({
      owner,
      repo: repoName,
      ref: row.target_branch ?? `pull/${row.pr_number}/head`,
    });
    // Vacuous truth on an empty array would let auto-merge fire when
    // CI hasn't reported yet. Require at least one passing check.
    ciSucceeded =
      checks.data.check_runs.length > 0 &&
      checks.data.check_runs.every(
        (c) => c.conclusion === "success" || c.conclusion === "skipped",
      );

    const reviews = await octokit.rest.pulls.listReviews({
      owner,
      repo: repoName,
      pull_number: row.pr_number,
    });
    botApproved = reviews.data.some(
      (r) => r.state === "APPROVED" && r.user?.login === botLogin,
    );
    humanChangesRequested = reviews.data.some(
      (r) =>
        r.state === "CHANGES_REQUESTED" && !r.user?.login?.endsWith("[bot]"),
    );
  } catch (err) {
    console.warn(
      "[pr-policy] PR state lookup failed; auto-merge will likely defer:",
      (err as Error).message,
    );
  }

  let trustLevel: ResolvedDarkFactorySettings["auto_merge"]["min_trust"] =
    "docs";
  try {
    const r = await query<{ settings: { trust?: { level?: string } } }>(
      `SELECT settings FROM lore.repos WHERE full_name = $1`,
      [row.target_repo],
    );
    const lvl = r[0]?.settings?.trust?.level as
      | "docs"
      | "tests"
      | "implementation"
      | "full"
      | undefined;
    if (lvl) trustLevel = lvl;
  } catch {
    // Default already set.
  }

  return {
    repo: row.target_repo,
    prNumber: row.pr_number,
    octokit,
    policy: {
      darkFactoryEnabled: settings.enabled,
      autoMerge: {
        paths: settings.auto_merge.paths,
        min_trust: settings.auto_merge.min_trust,
        require_green_ci: settings.auto_merge.require_green_ci,
        require_bot_approval: settings.auto_merge.require_bot_approval,
      },
      trustLevel,
      changedPaths,
      ciSucceeded,
      botApproved,
      humanChangesRequested,
    },
  };
}
