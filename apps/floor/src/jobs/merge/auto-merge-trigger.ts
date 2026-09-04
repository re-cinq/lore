/** Watcher-side auto-merge trigger after PR creation; delegates to evaluateAndMerge. */

import {
  resolveDarkFactorySettings,
  type ResolvedDarkFactorySettings,
} from "@re-cinq/lore-shared";
import { settings as settingsRepo, taskStore } from "../../kernel/queues.js";
import { resolvePrForTaskFromDb } from "./pr-policy.js";
import { evaluateAndMerge, type AutoMergeDecision } from "./auto-merge.js";

/** Resolves the task's target repo and its dark-factory settings, or null when the task has no repo or dark-factory is off. */
async function resolveEnabledDarkFactorySettings(
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

  return settings.enabled ? settings : null;
}

export async function tryAutoMergeForCompletedTask(opts: {
  taskId: string;
}): Promise<AutoMergeDecision | null> {
  // Resolve dark-factory settings before GitHub API round-trip.
  const settings = await resolveEnabledDarkFactorySettings(opts.taskId);

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
