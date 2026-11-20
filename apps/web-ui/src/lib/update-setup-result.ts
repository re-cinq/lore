import type { OnboardTaskResult } from "./onboard";

/** What "Update setup" did for one repo: queued a run, found one already in flight, or was refused. */
export type SetupOutcome =
  | { repo: string; status: "started"; taskId: string }
  | { repo: string; status: "running"; taskId: string }
  | { repo: string; status: "refused"; reason: string };

export function setupOutcome(
  repo: string,
  result: OnboardTaskResult,
): SetupOutcome {
  if (result.ok) {
    return { repo, status: "started", taskId: result.taskId };
  }

  return result.taskId
    ? { repo, status: "running", taskId: result.taskId }
    : { repo, status: "refused", reason: result.message };
}
