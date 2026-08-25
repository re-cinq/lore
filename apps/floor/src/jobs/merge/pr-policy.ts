/**
 * PR-state → AutoMergePolicyInputs lookup for the auto-merge gate.
 *
 * It sits beside its ONE caller, `auto-merge-trigger.ts`. It used to have two —
 * the in-agent orchestrator was the other — but that path was deleted with the
 * in-process supervisor (#805), and the header kept claiming a second caller
 * that no longer existed.
 *
 * It does not move to a station or to shared, for the same reason the rest of
 * `jobs/merge/` does not: merge authority is Floor-side by decision (ADR-016),
 * never inside a pod that also runs repo content. This reads the state that
 * authority is exercised on, so it belongs on the same side of that line.
 *
 * PR state is read through the Project facade's `pulls` (paginated inside the
 * shared adapter), not a hand-built Octokit — the auto-merge gate must see every
 * changed file / check / review, and the auth ladder lives once in PlatformGitHub.
 */
import type { ResolvedDarkFactorySettings } from "@re-cinq/lore-shared";
import type { PullRequests } from "@re-cinq/lore-shared/project/pulls/pull-requests.js";
import type { TaskPrInfo } from "@re-cinq/lore-shared/project/tasks/task-queue-port.js";
import { projectFor } from "../../composition/project-boot.js";
import { pipeline, settings } from "../../kernel/queues.js";

/** PR coordinates for one task id (the auto-merge policy lookup). */
export interface PrInfoReader {
  prInfo(taskId: string): Promise<TaskPrInfo | null>;
}

/** The repo's raw settings JSONB (read for `trust.level`). */
export interface RepoSettingsReader {
  rawSettings(repo: string): Promise<Record<string, unknown> | null>;
}

export interface PrPolicyDeps {
  tasks: PrInfoReader;
  repos: RepoSettingsReader;
  /** The PR facade for a repo — defaults to the Project facade; injectable for tests. */
  pullsFor: (repo: string) => Promise<PullRequests>;
}

export interface PrForAutoMerge {
  repo: string;
  prNumber: number;
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
    reviewInFlight: boolean;
  };
}

const defaultPullsFor = (repo: string): Promise<PullRequests> =>
  projectFor(repo).then((p) => p.pulls);

type TrustLevel = "docs" | "tests" | "implementation" | "full";

/**
 * The repo's configured trust level, read from `lore.repos.settings.trust.level`.
 * Mirrors the former PgReposRepository.trustLevel: undefined on absence or a
 * settings-read failure (so a DB hiccup leaves the conservative `docs` default).
 */
async function readTrustLevel(
  repos: RepoSettingsReader,
  repo: string,
): Promise<TrustLevel | undefined> {
  try {
    const raw = (await repos.rawSettings(repo)) as {
      trust?: { level?: string };
    } | null;

    return raw?.trust?.level as TrustLevel | undefined;
  } catch {
    return undefined;
  }
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
  darkFactorySettings: ResolvedDarkFactorySettings,
  deps: PrPolicyDeps = {
    tasks: pipeline().taskQueue,
    repos: settings(),
    pullsFor: defaultPullsFor,
  },
): Promise<PrForAutoMerge | null> {
  const row = await deps.tasks.prInfo(taskId);

  if (!row?.pr_number || !row.target_repo) {
    return null;
  }

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
    // All three reads are paginated inside the shared adapter (a single API page
    // caps at 30 and would silently truncate the file allowlist gate / check set /
    // review list). Independent — run them together.
    const pulls = await deps.pullsFor(row.target_repo);
    const ref = row.target_branch ?? `pull/${row.pr_number}/head`;
    const [files, checkRuns, reviews] = await Promise.all([
      pulls.listFiles(row.pr_number),
      pulls.listChecks(ref),
      pulls.listReviews(row.pr_number),
    ]);

    changedPaths = files;

    // Vacuous truth on an empty array would let auto-merge fire when
    // CI hasn't reported yet. Require at least one passing check.
    ciSucceeded =
      checkRuns.length > 0 &&
      checkRuns.every(
        (c) => c.conclusion === "success" || c.conclusion === "skipped",
      );

    // The bot re-reviews on every push (the code-review-recheck line), so a
    // stale early APPROVED must not linger past a later REQUEST_CHANGES: take the
    // bot's LATEST decision, not "any past approval". `id` is monotonic, so it
    // orders reviews by submission; COMMENT/DISMISSED are not decisions.
    const botDecisions = reviews
      .filter(
        (r) =>
          r.user === botLogin &&
          (r.state === "APPROVED" || r.state === "CHANGES_REQUESTED"),
      )
      .sort((a, b) => a.id - b.id);

    botApproved = botDecisions.at(-1)?.state === "APPROVED";
    humanChangesRequested = reviews.some(
      (r) => r.state === "CHANGES_REQUESTED" && !r.user.endsWith("[bot]"),
    );
  } catch (err) {
    console.warn(
      "[pr-policy] PR state lookup failed; auto-merge will likely defer:",
      (err as Error).message,
    );
  }

  // Defer auto-merge while a review-family line is open for this PR (the required
  // lore/code-review check does the same for human merges; this guards Lore's own).
  let reviewInFlight = false;

  try {
    const project = await projectFor(row.target_repo);

    reviewInFlight =
      (await project.assemblyRuns.findOpenByPr(row.pr_number)).length > 0;
  } catch (err) {
    console.warn(
      "[pr-policy] review-in-flight lookup failed:",
      (err as Error).message,
    );
  }

  let trustLevel: ResolvedDarkFactorySettings["auto_merge"]["min_trust"] =
    "docs";
  const lvl = await readTrustLevel(deps.repos, row.target_repo);

  if (lvl) {
    trustLevel = lvl;
  }

  return {
    repo: row.target_repo,
    prNumber: row.pr_number,
    policy: {
      darkFactoryEnabled: darkFactorySettings.enabled,
      autoMerge: {
        paths: darkFactorySettings.auto_merge.paths,
        min_trust: darkFactorySettings.auto_merge.min_trust,
        require_green_ci: darkFactorySettings.auto_merge.require_green_ci,
        require_bot_approval:
          darkFactorySettings.auto_merge.require_bot_approval,
      },
      trustLevel,
      changedPaths,
      ciSucceeded,
      botApproved,
      humanChangesRequested,
      reviewInFlight,
    },
  };
}
