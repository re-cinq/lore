/** Watcher-side auto-merge trigger after PR creation; delegates to evaluateAndMerge. */

import {
  resolveDarkFactorySettings,
  type ResolvedDarkFactorySettings,
} from "@re-cinq/lore-shared";
import { settings as settingsRepo, taskStore } from "../../outbound/queues.js";
import { resolvePrForTaskFromDb } from "./pr-policy.js";
import { evaluateAndMerge, type AutoMergeDecision } from "./auto-merge.js";

export async function tryAutoMergeForCompletedTask(opts: {
  taskId: string;
}): Promise<AutoMergeDecision | null> {
  // Resolve settings before the GitHub API round-trip.
  const settings = await resolveAutoMergeSettings(opts.taskId);

  if (!settings) {
    return null;
  }

  const pr = await resolvePrForTaskFromDb(opts.taskId, settings);

  if (!pr) {
    return null;
  }

  return evaluateAndMerge({
    taskId: opts.taskId,
    repo: pr.repo,
    prNumber: pr.prNumber,
    policy: pr.policy,
  });
}

/** Resolves the task's target repo and its dark-factory settings, or null when the task has no repo or auto-merge is off for it. */
async function resolveAutoMergeSettings(
  taskId: string,
): Promise<ResolvedDarkFactorySettings | null> {
  const task = await taskStore().getById(taskId);
  const targetRepo = task?.target_repo;

  if (!targetRepo) {
    return null;
  }

  const rawSettings = await settingsRepo().rawSettings(targetRepo);
  const darkFactoryRaw = (rawSettings?.dark_factory ?? null) as Parameters<
    typeof resolveDarkFactorySettings
  >[0];
  const settings = resolveDarkFactorySettings(darkFactoryRaw);

  return settings.auto_merge.enabled ? settings : null;
}
