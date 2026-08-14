import { onboardRepo, type OnboardBlockedBody } from "./api/repos";

export type OnboardBlock = OnboardBlockedBody["blocked"];

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
 * The guard itself lives in lore-api, which runs the state read and both writes
 * in one transaction under a per-repo advisory lock. web-ui previously ran that
 * transaction here against a hand-kept mirror of the guard rules; a rule that
 * exists to make an action singular cannot be duplicated across two services.
 * A refusal arrives as a 409 whose body names the block and the blocking task.
 */
export async function createOnboardTask(
  fullName: string,
  options: { reonboard?: boolean } = {},
): Promise<OnboardTaskResult> {
  const result = await onboardRepo(fullName, options);

  if (result.status === "ok") {
    return { ok: true, taskId: result.data.task_id };
  }

  const body = (
    result.status === "error" ? result.body : null
  ) as OnboardBlockedBody | null;

  return {
    ok: false,
    // A transport failure is not a guard refusal, but the submitter still needs
    // a block to render; "in-flight" is the safe read — it tells them to look
    // for an existing task rather than to submit again.
    block: body?.blocked ?? "in-flight",
    message:
      result.status === "unconfigured"
        ? "Onboarding is unavailable: the web UI has no lore-api configured."
        : result.message,
    taskId: body?.task_id ?? null,
  };
}
