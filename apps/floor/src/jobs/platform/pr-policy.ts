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
import {
  pgRepos,
  pgTasks,
  type ReposRepository,
  type TasksRepository,
} from "../../kernel/repositories/index.js";

export interface PrPolicyDeps {
  tasks: TasksRepository;
  repos: ReposRepository;
}

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
  deps: PrPolicyDeps = { tasks: pgTasks, repos: pgRepos },
): Promise<PrForAutoMerge | null> {
  const row = await deps.tasks.prInfo(taskId);
  if (!row?.pr_number || !row.target_repo) return null;

  const [owner, repoName] = row.target_repo.split("/");
  let ciSucceeded = false;
  let botApproved = false;
  // Mixed-default note: `humanChangesRequested = false` is the
  // *permissive* state for that flag (no human blocking), unlike
  // ciSucceeded/botApproved where false is conservative. Safe because
  // the listReviews call is in the same try block as listFiles +
  // listForRef — if any of them throws, all three flags stay at their
  // initial values and `ciSucceeded = false` alone causes the engine
  // to defer with `deferred:ci_failed`, so the others' values never
  // matter on the API-failure path. Don't "fix" by flipping to true —
  // that would block merges when the API is healthy and there are
  // simply no human reviews yet (the common case).
  let humanChangesRequested = false;
  let changedPaths: string[] = [];
  // Specific bot login the auto-merge gate trusts. Defaults to the
  // Lore agent App slug as configured by the GitHub App's
  // installation (visible in the App's settings page; the production
  // value is "lore-agent[bot]" matching the App name). Deployments
  // using a different App slug override via LORE_REVIEW_BOT_LOGIN.
  // Without this, *any* bot's APPROVED review (Dependabot, Renovate,
  // an external review bot) would satisfy require_bot_approval.
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
  const lvl = await deps.repos.trustLevel(row.target_repo);
  if (lvl) trustLevel = lvl;

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
