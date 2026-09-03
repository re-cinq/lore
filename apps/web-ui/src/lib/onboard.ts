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

/** Queue onboard task, refusing duplicates (already onboarded, PR open, task in-flight); pass reonboard for missing-files repair; guard runs in lore-api under per-repo lock (#968). */
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
    // Transport failure is not a guard refusal, but submitter needs a block; "in-flight" is the safe read.
    block: body?.blocked ?? "in-flight",
    message:
      result.status === "unconfigured"
        ? "Onboarding is unavailable: the web UI has no lore-api configured."
        : result.message,
    taskId: body?.task_id ?? null,
  };
}
