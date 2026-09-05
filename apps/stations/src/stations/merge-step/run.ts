/** Bind one merge step to the ports this process holds (composition root). */

import type { NodeResult } from "@re-cinq/lore-assembly-lines";
import type { StationInput } from "@re-cinq/lore-shared/station-input.js";
import {
  writeEpisodeWithCuration,
  type PipelineTask,
} from "@re-cinq/lore-shared";
import type { MergeableTask } from "@re-cinq/lore-shared/project/tasks/task-queue-port.js";
import { runMergeStep, type MergeStepDeps } from "./merge-step.js";
import type { MergeStepTask } from "./merge-step.js";
import {
  applyOutcomeFeedback,
  maybeFlipSpecStatus,
  promoteTrust,
  syncSpecTasksFromMerge,
} from "../merge-check/merge-check.js";
import {
  eventReporter,
  memoryLifecycle,
  pipeline,
  settings,
  taskStore,
} from "../../kernel/queues.js";
import { projectFor } from "../../kernel/project-boot.js";

/** Hours between two timestamps, or null when the PR was never merged. */
const hoursBetween = (from: string, to: string | null): number | null =>
  to === null
    ? null
    : Math.round(
        (new Date(to).getTime() - new Date(from).getTime()) / 3_600_000,
      );

/** True when a task row exists and carries the PR number a merge step needs. */
export function hasMergeStepFields(
  row: PipelineTask | null,
): row is PipelineTask & { pr_number: number } {
  return row !== null && row.pr_number !== null && row.pr_number !== undefined;
}

/** Narrows a task-store row to the small shape the merge line's steps read. */
export function toMergeStepTask(
  row: PipelineTask & { pr_number: number },
): MergeStepTask {
  return {
    id: row.id,
    target_repo: row.target_repo,
    pr_number: row.pr_number,
    issue_number: row.issue_number ?? null,
    task_type: row.task_type,
    description: row.description,
  };
}

/** Normalises a task-store row's task-store-only-undefined fields to the sweep's explicit null. */
export function toFlipSpecStatusTask(
  row: PipelineTask | null,
  now: string,
): MergeableTask {
  const merged = { ...row } as NonNullable<typeof row>;

  return {
    ...merged,
    target_branch: merged.target_branch ?? null,
    pr_url: merged.pr_url ?? null,
    task_group_id: merged.task_group_id ?? null,
    context_bundle: merged.context_bundle ?? null,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- row is an unchecked `as PipelineTask` cast over a raw pg row; a short SELECT can still leave created_at undefined
    created_at: merged.created_at ?? now,
  } as MergeableTask;
}

function productionDeps(): MergeStepDeps {
  // Cache the whole row to hand to helpers rather than widening the step contract.
  let row: PipelineTask | null = null;

  return {
    task: async (id) => {
      row = await taskStore().getById(id);

      return hasMergeStepFields(row) ? toMergeStepTask(row) : null;
    },
    setStatus: (id, status) => taskStore().setStatus(id, status),
    recordEvent: async (id, from, to) => {
      await taskStore().recordEvent(id, from, to, { merged_by: "merge-line" });
    },
    flipSpecStatus: async (task) => {
      await maybeFlipSpecStatus(
        await projectFor(task.target_repo),
        toFlipSpecStatusTask(row, new Date().toISOString()),
      );
    },
    commentAndCloseIssue: async (task) => {
      const issues = (await projectFor(task.target_repo)).issues;

      await issues.comment(
        task.issue_number as number,
        `PR #${task.pr_number} merged.`,
      );
      await issues.close(task.issue_number as number, "completed");
    },
    recordOutcome: async (task) => {
      const stats = await (
        await projectFor(task.target_repo)
      ).pulls.getStats(task.pr_number);

      await settings().bumpOutcomeStats(
        task.target_repo,
        stats.files_changed,
        hoursBetween(stats.created_at, stats.merged_at) ?? 0,
      );
    },
    curate: async (task) => {
      const stats = await (
        await projectFor(task.target_repo)
      ).pulls.getStats(task.pr_number);

      await writeEpisodeWithCuration(
        { memory: memoryLifecycle() },
        {
          content: [
            `Task ${task.task_type} on ${task.target_repo}: PR #${task.pr_number} merged.`,
            `Files changed: ${stats.files_changed}, +${stats.additions}/-${stats.deletions}`,
            `Review comments: ${stats.comments}`,
            `Time to merge: ${hoursBetween(stats.created_at, stats.merged_at)}h`,
            `Description: ${task.description.substring(0, 200)}`,
          ].join("\n"),
          source: "ci",
          ref: `${task.target_repo}/${task.id}`,
          agentId: "merge-line",
          taskId: task.id,
        },
      );
    },
    applyOutcomeFeedback: (id, kind) => applyOutcomeFeedback(id, kind),
    promoteTrust,
    syncSpecTasks: (task) =>
      syncSpecTasksFromMerge({
        ...task,
        target_branch: row?.target_branch ?? null,
      } as Parameters<typeof syncSpecTasksFromMerge>[0]),
    resumePlanning: async (repo, prNumber) => {
      const { resumeDecomposition } =
        await import("@re-cinq/lore-shared/project/assembly-runs/decompose-resume.js");
      const { eventReport } =
        await import("@re-cinq/lore-shared/project/assembly-runs/decompose-resume.js");

      await resumeDecomposition(
        { repo, prNumber },
        {
          assemblyRuns: pipeline().assemblyRuns,
          report: eventReport(eventReporter()),
        },
      );
    },
  };
}

export async function runMergeStepNode(
  input: StationInput,
): Promise<NodeResult> {
  const step =
    (input.params as Record<string, string | undefined>).job_ref ?? "";
  const taskId = input.task_id;

  if (!taskId) {
    return {
      outcome: "failed",
      failureClass: "unknown",
      failureDetail: `merge step "${step}" has no task to act on`,
    };
  }

  // No catch: the LINE is the error handling (failed edge routes forward).
  try {
    await runMergeStep(step, taskId, productionDeps());

    return { outcome: "success", extras: { "Lore-Merge-Step": step } };
  } catch (err) {
    return {
      outcome: "failed",
      failureClass: "unknown",
      failureDetail: `merge step "${step}": ${(err as Error).message}`,
    };
  }
}
