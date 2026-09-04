// PR-state → AutoMergePolicyInputs lookup, staying Floor-side (never in a pod) because merge authority is Floor-side by decision (ADR-016); its sole caller is auto-merge-trigger.ts.
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

/** The repo's configured trust level; undefined on absence or a settings-read failure, so a DB hiccup leaves the conservative `docs` default. */
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

/** The PR-shape half of the policy inputs — everything read from checks/reviews/files, as opposed to trust level or review-in-flight. */
interface PrCheckState {
  changedPaths: string[];
  ciSucceeded: boolean;
  botApproved: boolean;
  humanChangesRequested: boolean;
}

// `humanChangesRequested: false` is deliberately the *permissive* default (unlike the other two): a lookup failure leaves `ciSucceeded: false` to defer the merge on its own, so this one staying false never wrongly blocks a healthy PR with no reviews yet.
const DEFAULT_PR_CHECK_STATE: PrCheckState = {
  changedPaths: [],
  ciSucceeded: false,
  botApproved: false,
  humanChangesRequested: false,
};

/** Reads changed files, CI conclusion, and the trusted bot's + any human's review decisions; defers (via `DEFAULT_PR_CHECK_STATE`) rather than throws, so a lookup failure never blocks the rest of the policy read. */
async function readPrCheckState(
  deps: PrPolicyDeps,
  row: TaskPrInfo,
  botLogin: string,
): Promise<PrCheckState> {
  try {
    // All three reads are paginated inside the shared adapter (an uncapped single page would silently truncate); independent, so run them together.
    const pulls = await deps.pullsFor(row.target_repo!);
    const ref = row.target_branch ?? `pull/${row.pr_number}/head`;
    const [files, checkRuns, reviews] = await Promise.all([
      pulls.listFiles(row.pr_number!),
      pulls.listChecks(ref),
      pulls.listReviews(row.pr_number!),
    ]);

    // Require at least one passing check — vacuous truth on an empty array would let auto-merge fire before CI has reported.
    const ciSucceeded =
      checkRuns.length > 0 &&
      checkRuns.every(
        (c) => c.conclusion === "success" || c.conclusion === "skipped",
      );

    // Take the bot's LATEST decision (monotonic `id` orders by submission), not "any past approval" — a stale early APPROVED must not linger past a later REQUEST_CHANGES.
    const botDecisions = reviews
      .filter(
        (r) =>
          r.user === botLogin &&
          (r.state === "APPROVED" || r.state === "CHANGES_REQUESTED"),
      )
      .sort((a, b) => a.id - b.id);

    return {
      changedPaths: files,
      ciSucceeded,
      botApproved: botDecisions.at(-1)?.state === "APPROVED",
      humanChangesRequested: reviews.some(
        (r) => r.state === "CHANGES_REQUESTED" && !r.user.endsWith("[bot]"),
      ),
    };
  } catch (err) {
    console.warn(
      "[pr-policy] PR state lookup failed; auto-merge will likely defer:",
      (err as Error).message,
    );

    return DEFAULT_PR_CHECK_STATE;
  }
}

/** Defers auto-merge while a review-family line is open for this PR — the required lore/code-review check does the same for human merges; this guards Lore's own. */
async function readReviewInFlight(
  repo: string,
  prNumber: number,
): Promise<boolean> {
  try {
    const project = await projectFor(repo);

    return (await project.assemblyRuns.findOpenByPr(prNumber)).length > 0;
  } catch (err) {
    console.warn(
      "[pr-policy] review-in-flight lookup failed:",
      (err as Error).message,
    );

    return false;
  }
}

/** True once both fields auto-merge needs are present — narrows `pr_number`/`target_repo` from optional to required for the rest of the resolution. */
function hasResolvedPr(
  row: TaskPrInfo | null,
): row is TaskPrInfo & { pr_number: number; target_repo: string } {
  return Boolean(row?.pr_number && row.target_repo);
}

/** Look up everything `evaluateAndMerge` needs by task id; defaults assume CI hasn't passed and the bot hasn't approved, since flipping to `true` would let auto-merge fire on a brand-new PR with no check_runs/reviews yet. */
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

  if (!hasResolvedPr(row)) {
    return null;
  }

  // Trusted bot login, overridable via LORE_REVIEW_BOT_LOGIN — without it, any bot's APPROVED review (Dependabot, Renovate, etc.) would satisfy require_bot_approval.
  const botLogin = process.env.LORE_REVIEW_BOT_LOGIN ?? "lore-agent[bot]";
  const checkState = await readPrCheckState(deps, row, botLogin);
  const reviewInFlight = await readReviewInFlight(
    row.target_repo,
    row.pr_number,
  );
  const trustLevel =
    (await readTrustLevel(deps.repos, row.target_repo)) ?? "docs";

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
      ...checkState,
      reviewInFlight,
    },
  };
}
