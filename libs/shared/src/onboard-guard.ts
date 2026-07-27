/**
 * Guard for onboard-task submissions.
 *
 * Every entry point that queues an `onboard` task (the web-ui onboard form, the
 * repo-page "re-run onboarding" button, `POST /api/onboard` behind
 * `lore_onboard_repo`) resolves the repo's onboarding state and runs it through
 * `decideOnboard` before writing. Without it a repo that is already onboarded —
 * or that has an onboard task still running — collects duplicate tasks, each of
 * which files its own GitHub Issue and races its own PR.
 *
 * web-ui mirrors this module in `apps/web-ui/src/lib/onboard-guard.ts` (it is
 * not a workspace member and cannot import the package); the mirror is held in
 * lockstep by `onboard-guard.parity.test.ts`.
 */

/** Statuses an onboard task holds while it still counts as in flight. */
export const IN_FLIGHT_TASK_STATUSES = ["pending", "queued", "running"];

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
 * the explicit repair path (the repo-page button), which is allowed to run
 * against an onboarded repo but still never allowed to double up on one in
 * flight.
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
      message: `An onboard task for ${repo} is already in flight — wait for it to finish instead of queueing a second one.`,
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
      message: `${repo} is already onboarded. Use "Re-run onboarding" on the repo page to regenerate missing scaffolding.`,
    };
  }

  if (state.openOnboardingPrUrl) {
    return {
      allowed: false,
      block: "pr-open",
      taskId: null,
      message: `${repo} already has an onboarding PR waiting to be merged: ${state.openOnboardingPrUrl}`,
    };
  }

  return { allowed: true };
}
