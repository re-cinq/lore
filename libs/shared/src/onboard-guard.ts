// Guard for onboard-task submissions: every queueing entry point runs `decideOnboard` first, so a repo already onboarded or mid-onboard can't collect duplicate tasks each filing its own Issue/PR (#968). web-ui mirrors this in apps/web-ui/src/lib/onboard-guard.ts, held in lockstep by onboard-guard.parity.test.ts.

// Statuses where an onboard task still counts as in flight — the union of pending/running in task-store-pg.ts; narrower would miss awaiting_approval/running-local/pr-created.
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

function openOnboardingPrUrl(
  repoRow: OnboardRepoRow | undefined,
  merged: boolean,
): string | null {
  if (merged) {
    return null;
  }

  return repoRow?.onboarding_pr_url ?? null;
}

// Derives the guard's input from the two query rows so the API and UI can't disagree; a merged onboarding PR masks its url so the repo reads as `already-onboarded`, not PR-pending.
export function toOnboardState(
  repoRow: OnboardRepoRow | undefined,
  taskRow: OnboardTaskRow | undefined,
): OnboardState {
  const merged = repoRow?.onboarding_pr_merged === true;

  return {
    onboardingPrMerged: merged,
    openOnboardingPrUrl: openOnboardingPrUrl(repoRow, merged),
    inFlightTaskId: taskRow?.id ?? null,
  };
}

// Advisory-lock key serializing onboard submissions for one repo — both apps take pg_advisory_xact_lock(hashtext(<this>)) before reading state and writing the task.
export function onboardLockKey(repo: string): string {
  return `lore.onboard:${repo}`;
}

// The pipeline turns this into the filed GitHub Issue's body — a bare repo name (what the UI used to send) produced an Issue reading as an empty request.
export function onboardTaskDescription(repo: string): string {
  return (
    `Onboard ${repo} into Lore: inspect the repo and generate the scaffolding it is ` +
    `missing (CLAUDE.md, AGENTS.md, PR template, CI workflows), then open a single PR. ` +
    `Leave files that already exist untouched.`
  );
}

// `reonboard` (the repo-page button) may target an already-onboarded repo but still respects the in-flight/open-PR blocks — either bypass would put a second agent on scaffolding one is already writing.
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
