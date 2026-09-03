/** Watcher-side auto-merge trigger after PR creation; delegates to evaluateAndMerge. */

import { resolveDarkFactorySettings } from "@re-cinq/lore-shared";
import { settings as settingsRepo, taskStore } from "../../kernel/queues.js";
import { resolvePrForTaskFromDb } from "./pr-policy.js";
import { evaluateAndMerge, type AutoMergeDecision } from "./auto-merge.js";

export async function tryAutoMergeForCompletedTask(opts: {
  taskId: string;
}): Promise<AutoMergeDecision | null> {
  // Resolve dark-factory settings before GitHub API round-trip.
  const task = await taskStore().getById(opts.taskId);
  const targetRepo = task?.target_repo;

  if (!targetRepo) {
    return null;
  }

  const rawSettings = await settingsRepo().rawSettings(targetRepo);
  const settings = resolveDarkFactorySettings(
    (rawSettings?.dark_factory as Parameters<
      typeof resolveDarkFactorySettings
    >[0]) ?? null,
  );

  if (!settings.enabled) {
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
