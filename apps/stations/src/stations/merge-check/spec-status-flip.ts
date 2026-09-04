import { openSpecStatusFlipPr } from "@re-cinq/lore-shared";
import type { Project, StatusFlipResult } from "@re-cinq/lore-shared";
import type { MergeableTask } from "@re-cinq/lore-shared/project/tasks/task-queue-port.js";
import { pipeline } from "../../kernel/queues.js";

// spec-status-upkeep FR1: flip a spec's `| Status |` row to `shipped` once every task in its group is merged (ADR-016).

/** Decide whether merged task completes its feature's task group (pure). */
export function decideSpecStatusFlip(
  task: Pick<MergeableTask, "task_type" | "task_group_id" | "context_bundle">,
  remainingInGroup: number,
): { featureId: string } | null {
  if (task.task_type !== "spec-task" || !task.task_group_id) {
    return null;
  }

  if (remainingInGroup > 0) {
    return null;
  }
  const featureId = task.context_bundle?.feature_id;

  return featureId ? { featureId } : null;
}

/** Keep features table in sync with spec status (FR1). */
export function decideFeatureImplemented(result: StatusFlipResult): boolean {
  return (
    result.status === "shipped" &&
    (!result.skipped || result.reason === "already-current")
  );
}

/** The log line for a flip that landed the spec on `shipped`. */
export function describeFlipSuccess(
  specPath: string,
  result: Pick<StatusFlipResult, "prUrl" | "skipped">,
): string {
  return (
    `[job] merge-check: spec-status-upkeep marked ${specPath} implemented ` +
    `(${result.skipped ? "already current" : result.prUrl})`
  );
}

/** The log line for a flip that did not confirm `shipped`, left for a human to reconcile. */
export function describeFlipMiss(
  specPath: string,
  result: Pick<StatusFlipResult, "prUrl" | "status" | "reason">,
  featureId: string,
): string {
  return (
    `[job] merge-check: spec-status-upkeep did not mark ${specPath} shipped ` +
    `(status=${result.status ?? "unreadable"}, reason=${result.reason ?? "flipped"}` +
    `${result.prUrl ? `, pr=${result.prUrl}` : ""}); ` +
    `feature ${featureId} left for human reconcile`
  );
}

export async function maybeFlipSpecStatus(
  project: Project,
  task: MergeableTask,
): Promise<void> {
  const remaining = task.task_group_id
    ? await pipeline().taskQueue.countUnmergedInGroup(task.task_group_id)
    : 0;
  const decision = decideSpecStatusFlip(task, remaining);

  if (!decision) {
    return;
  }

  const feature = await project.features.get(decision.featureId);

  if (!feature) {
    return;
  }
  const specPath = feature.spec_path ?? `specs/${feature.slug}/spec.md`;
  const result = await openSpecStatusFlipPr(project, specPath, {
    evidence: `Completion: every task in group \`${task.task_group_id}\` is merged (last: PR #${task.pr_number}).`,
  });

  if (decideFeatureImplemented(result)) {
    await project.features.transitionStatus(decision.featureId, "implemented");
    console.log(describeFlipSuccess(specPath, result));

    return;
  }
  console.warn(describeFlipMiss(specPath, result, decision.featureId));
}
