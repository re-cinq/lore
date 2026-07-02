/**
 * Watcher-side auto-merge trigger. Closes the gap left open by
 * PR #310: the cluster-path runner-cli intentionally does NOT call
 * evaluateAndMerge inside the Job pod (the loretask-watcher owns PR
 * creation; firing from inside the pod would race the watcher). This
 * module is invoked by the watcher AFTER the PR is created and
 * pipeline.tasks has been updated with pr_number.
 *
 * Flow:
 *  1. Look up the task's repo settings.
 *  2. If dark mode is off → return null (no audit row written).
 *     Avoids cluttering pipeline.audit_log with deferred:dark_mode_off
 *     entries for every legacy-path task.
 *  3. Build policy via resolvePrForTaskFromDb (same lookup the in-agent
 *     retrospective handler uses — single source of truth).
 *  4. Delegate to evaluateAndMerge, which writes the audit row and
 *     performs the merge call when the policy allows.
 *
 * Lives in its own module (separate from auto-merge.ts) so unit tests
 * can vi.mock evaluateAndMerge — vi.mock can't intercept an in-module
 * direct call, only cross-module imports.
 */
import { resolveDarkFactorySettings } from "@re-cinq/lore-shared";
import { settings as settingsRepo, taskStore } from "../../kernel/queues.js";
import { resolvePrForTaskFromDb } from "../platform/pr-policy.js";
import { evaluateAndMerge, type AutoMergeDecision } from "./auto-merge.js";

export async function tryAutoMergeForCompletedTask(opts: {
  taskId: string;
}): Promise<AutoMergeDecision | null> {
  // Resolve the repo's dark-factory settings before paying the cost
  // of a GitHub API round-trip.
  const task = await taskStore().getById(opts.taskId);
  const targetRepo = task?.target_repo;
  if (!targetRepo) return null;

  const rawSettings = await settingsRepo().rawSettings(targetRepo);
  const settings = resolveDarkFactorySettings(
    (rawSettings?.dark_factory as Parameters<
      typeof resolveDarkFactorySettings
    >[0]) ?? null,
  );
  if (!settings.enabled) return null;

  const pr = await resolvePrForTaskFromDb(opts.taskId, settings);
  if (!pr) return null;

  return evaluateAndMerge({
    taskId: opts.taskId,
    repo: pr.repo,
    prNumber: pr.prNumber,
    policy: pr.policy,
  });
}
