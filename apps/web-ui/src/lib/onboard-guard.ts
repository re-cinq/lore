/**
 * Mirror of `libs/shared/src/onboard-guard.ts` — web-ui is not a workspace
 * member and cannot import `@re-cinq/lore-shared`, so the onboard guard is
 * hand-duplicated here. `onboard-guard.parity.test.ts` keeps the two in
 * lockstep; change both or neither.
 */

/**
 * Statuses an onboard task holds while it still counts as in flight: the union
 * of the pending and running sets in `project/tasks/task-store-pg.ts`. Anything
 * narrower lets a live task read as absent — an approval-gated onboard parks at
 * `awaiting_approval`, a locally claimed one sits at `running-local`, and one
 * that has already opened its PR sits at `pr-created`.
 */
export const IN_FLIGHT_TASK_STATUSES = [
  "pending",
  "queued",
  "awaiting_approval",
  "running",
  "running-local",
  "review",
  "pr-created",
] as const;

/** Reads the onboarding columns for one repo. `$1` = full name. */
export const ONBOARD_REPO_STATE_SQL = `SELECT onboarding_pr_merged, onboarding_pr_url
     FROM lore.repos WHERE full_name = $1`;

/** Newest in-flight onboard task for one repo. `$1` = full name, `$2` = statuses. */
export const ONBOARD_IN_FLIGHT_TASK_SQL = `SELECT id FROM pipeline.tasks
     WHERE target_repo = $1 AND task_type = 'onboard' AND status = ANY($2::text[])
     ORDER BY created_at DESC LIMIT 1`;

/** Onboarding state of one repo, read from `lore.repos` + `pipeline.tasks`. */
export interface OnboardState {
  /** `lore.repos.onboarding_pr_merged`; false when the repo has no row yet. */
  onboardingPrMerged: boolean;
  /** `lore.repos.onboarding_pr_url` while that PR is still unmerged. */
  openOnboardingPrUrl: string | null;
  /** Id of an in-flight `onboard` task for this repo, if one exists. */
  inFlightTaskId: string | null;
}

export type OnboardBlock = "in-flight" | "already-onboarded" | "pr-open";

export type OnboardDecision =
  | { allowed: true }
  | {
      allowed: false;
      block: OnboardBlock;
      message: string;
      /** The in-flight task to send the submitter to, when there is one. */
      taskId: string | null;
    };

/** The `lore.repos` row shape `ONBOARD_REPO_STATE_SQL` returns. */
export interface OnboardRepoRow {
  onboarding_pr_merged?: boolean | null;
  onboarding_pr_url?: string | null;
}

/** The `pipeline.tasks` row shape `ONBOARD_IN_FLIGHT_TASK_SQL` returns. */
export interface OnboardTaskRow {
  id?: string | null;
}

/**
 * Derives the guard's input from the two query rows, so the API and the UI
 * cannot disagree about what a missing row or a merged PR means. A merged
 * onboarding PR masks its url: such a repo must read as `already-onboarded`
 * rather than as one whose PR is still waiting to be merged.
 */
export function toOnboardState(
  repoRow: OnboardRepoRow | undefined,
  taskRow: OnboardTaskRow | undefined,
): OnboardState {
  const merged = repoRow?.onboarding_pr_merged === true;

  return {
    onboardingPrMerged: merged,
    openOnboardingPrUrl: merged ? null : (repoRow?.onboarding_pr_url ?? null),
    inFlightTaskId: taskRow?.id ?? null,
  };
}

/**
 * Advisory-lock key that serializes onboard submissions for one repo. Both apps
 * take `pg_advisory_xact_lock(hashtext(<this>))` before reading the state and
 * writing the task, so two concurrent submissions cannot both see a clear board.
 */
export function onboardLockKey(repo: string): string {
  return `lore.onboard:${repo}`;
}

/**
 * Description an onboard task carries. The pipeline turns this into the body of
 * the GitHub Issue it files, so a bare repo name (what the UI used to send)
 * produces an Issue that reads as an empty request.
 */
export function onboardTaskDescription(repo: string): string {
  return (
    `Onboard ${repo} into Lore: inspect the repo and generate the scaffolding it is ` +
    `missing (CLAUDE.md, AGENTS.md, PR template, CI workflows), then open a single PR. ` +
    `Leave files that already exist untouched.`
  );
}

/**
 * Decides whether an onboard task may be queued for `repo`. `reonboard` marks
 * the explicit repair path (the repo-page button), which may run against an
 * already-onboarded repo — but never against one whose onboarding is still
 * unfinished, so it waives neither the in-flight block nor the open-PR block.
 * Either would put a second agent on scaffolding an agent is already writing.
 */
export function decideOnboard(
  repo: string,
  state: OnboardState,
  options: { reonboard?: boolean } = {},
): OnboardDecision {
  if (state.inFlightTaskId) {
    return {
      allowed: false,
      block: "in-flight",
      taskId: state.inFlightTaskId,
      message:
        `An onboard task for ${repo} is already in flight — wait for it to ` +
        `finish instead of queueing a second one.`,
    };
  }

  if (state.openOnboardingPrUrl) {
    return {
      allowed: false,
      block: "pr-open",
      taskId: null,
      message:
        `${repo} already has an onboarding PR waiting to be merged: ` +
        state.openOnboardingPrUrl,
    };
  }

  if (options.reonboard) {
    return { allowed: true };
  }

  if (state.onboardingPrMerged) {
    return {
      allowed: false,
      block: "already-onboarded",
      taskId: null,
      message:
        `${repo} is already onboarded. Use "Re-run onboarding" on the repo ` +
        `page to regenerate missing scaffolding.`,
    };
  }

  return { allowed: true };
}
