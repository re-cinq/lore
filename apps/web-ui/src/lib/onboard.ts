import {
  onboardRepo,
  type OnboardBlockedBody,
  type OnboardResult,
} from "./api/repos";
import type { ApiResult } from "./api/result";

type OnboardRefusal = Exclude<ApiResult<OnboardResult>, { status: "ok" }>;

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

  return resolveRefusal(result);
}

/** Builds the refusal shape for every non-ok guard outcome. */
function resolveRefusal(result: OnboardRefusal): OnboardTaskResult {
  const body = blockedBody(result);

  return {
    ok: false,
    // Transport failure is not a guard refusal, but submitter needs a block; "in-flight" is the safe read.
    block: body?.blocked ?? "in-flight",
    message: refusalMessage(result),
    taskId: body?.task_id ?? null,
  };
}

function blockedBody(result: OnboardRefusal): OnboardBlockedBody | null {
  return result.status === "error"
    ? (result.body as OnboardBlockedBody | null)
    : null;
}

function refusalMessage(result: OnboardRefusal): string {
  return result.status === "unconfigured"
    ? "Onboarding is unavailable: the web UI has no lore-api configured."
    : result.message;
}

const REPO_SLUG = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

export function isRepoSlug(value: string): boolean {
  return REPO_SLUG.test(value);
}

export function onboardDestination(
  fullName: string,
  taskId: string | null,
): string {
  return taskId
    ? `/tasks/${encodeURIComponent(taskId)}`
    : `/?onboarded=${encodeURIComponent(fullName)}`;
}

export function onboardedParam(
  value: string | string[] | undefined,
): string | null {
  return typeof value === "string" && isRepoSlug(value) ? value : null;
}
