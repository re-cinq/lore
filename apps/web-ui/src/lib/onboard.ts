import { withTransaction, type QueryFn } from "./db";
import {
  decideOnboard,
  onboardLockKey,
  onboardTaskDescription,
  IN_FLIGHT_TASK_STATUSES,
  type OnboardBlock,
  type OnboardState,
} from "./onboard-guard";

export type OnboardTaskResult =
  | { ok: true; taskId: string }
  | {
      ok: false;
      block: OnboardBlock;
      message: string;
      /** The onboard task already in flight, when that is the reason. */
      taskId: string | null;
    };

/**
 * Reads the repo's onboarding state on `tx`, which must already hold the
 * per-repo advisory lock so the read cannot go stale before the write.
 */
async function readOnboardState(
  tx: QueryFn,
  fullName: string,
): Promise<OnboardState> {
  const repoRows = await tx<{
    onboarding_pr_merged: boolean;
    onboarding_pr_url: string | null;
  }>(
    `SELECT onboarding_pr_merged, onboarding_pr_url
     FROM lore.repos WHERE full_name = $1`,
    [fullName],
  );
  const taskRows = await tx<{ id: string }>(
    `SELECT id FROM pipeline.tasks
     WHERE target_repo = $1 AND task_type = 'onboard' AND status = ANY($2::text[])
     ORDER BY created_at DESC LIMIT 1`,
    [fullName, IN_FLIGHT_TASK_STATUSES],
  );
  const merged = repoRows[0]?.onboarding_pr_merged === true;

  return {
    onboardingPrMerged: merged,
    openOnboardingPrUrl: merged
      ? null
      : (repoRows[0]?.onboarding_pr_url ?? null),
    inFlightTaskId: taskRows[0]?.id ?? null,
  };
}

/**
 * Queue an `onboard` pipeline task for a repo, refusing the submission when one
 * would be a duplicate: the repo is already onboarded, its onboarding PR is
 * still open, or an onboard task is already in flight. Each task files its own
 * GitHub Issue and races its own PR, so a duplicate is never harmless (#968).
 *
 * Pass `reonboard` for the repo page's deliberate repair path — the agent then
 * generates only the files that are missing (e.g. a dropped
 * `.github/workflows/lore-ingest.yml`). That skips the already-onboarded check
 * but never the in-flight one.
 *
 * One transaction holding a per-repo advisory lock covers the state read, the
 * task, and the `lore.repos` row: concurrent submissions serialize behind the
 * lock and the second one sees the first one's task, so at most one is queued.
 * A repos row without its task would make a retry hit the already-onboarded
 * path, and a task without its repos row would queue a second onboard agent.
 */
export async function createOnboardTask(
  fullName: string,
  options: { reonboard?: boolean } = {},
): Promise<OnboardTaskResult> {
  const [owner, name] = fullName.split("/");

  return withTransaction(async (tx) => {
    await tx("SELECT pg_advisory_xact_lock(hashtext($1))", [
      onboardLockKey(fullName),
    ]);

    const decision = decideOnboard(
      fullName,
      await readOnboardState(tx, fullName),
      options,
    );

    if (!decision.allowed) {
      return {
        ok: false,
        block: decision.block,
        message: decision.message,
        taskId: decision.taskId,
      };
    }

    const task = await tx<{ id: string }>(
      `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by)
       VALUES ($1, 'onboard', $2, 'ui')
       RETURNING id`,
      [onboardTaskDescription(fullName), fullName],
    );
    const taskId = task[0].id;

    await tx(
      `INSERT INTO pipeline.task_events (task_id, to_status) VALUES ($1, 'pending')`,
      [taskId],
    );
    await tx(
      `INSERT INTO lore.repos (owner, name, full_name)
       VALUES ($1, $2, $3) ON CONFLICT (full_name) DO NOTHING`,
      [owner, name, fullName],
    );

    return { ok: true, taskId };
  });
}
