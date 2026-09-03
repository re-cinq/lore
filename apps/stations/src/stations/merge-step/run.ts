/**
 * Bind one merge step to the ports this process holds.
 *
 * The composition root for the merge line: the step functions take everything
 * they need, and this is where those become the real database, the real code
 * host and the real memory store.
 */

import type { NodeResult } from "@re-cinq/lore-assembly-lines";
import type { StationInput } from "@re-cinq/lore-shared/station-input.js";
import { writeEpisodeWithCuration } from "@re-cinq/lore-shared";
import { runMergeStep, type MergeStepDeps } from "./merge-step.js";
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

function productionDeps(): MergeStepDeps {
  // The steps take a narrow task; the helpers reused from the sweep want the
  // whole row. Rather than widen the step contract to whatever those helpers
  // happen to read, the row fetched for the step is kept here and handed to them.
  let row: Awaited<ReturnType<ReturnType<typeof taskStore>["getById"]>> = null;

  return {
    task: async (id) => {
      row = await taskStore().getById(id);

      return row === null ||
        row.pr_number === null ||
        row.pr_number === undefined
        ? null
        : {
            id: row.id,
            target_repo: row.target_repo ?? "",
            pr_number: row.pr_number,
            issue_number: row.issue_number ?? null,
            task_type: row.task_type,
            description: row.description ?? "",
          };
    },
    setStatus: (id, status) => taskStore().setStatus(id, status),
    recordEvent: async (id, from, to) => {
      await taskStore().recordEvent(id, from, to, { merged_by: "merge-line" });
    },
    flipSpecStatus: async (task) => {
      await maybeFlipSpecStatus(await projectFor(task.target_repo), {
        ...(row as NonNullable<typeof row>),
        // The sweep's row type spells absent fields `null`; the task store's
        // spells them `undefined`. Normalised here rather than widening either.
        target_branch: row?.target_branch ?? null,
        pr_url: row?.pr_url ?? null,
        task_group_id: row?.task_group_id ?? null,
        context_bundle: row?.context_bundle ?? null,
        created_at: row?.created_at ?? new Date().toISOString(),
      } as Parameters<typeof maybeFlipSpecStatus>[1]);
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
  const step = input.params.job_ref ?? "";
  const taskId = input.task_id;

  if (!taskId) {
    return {
      outcome: "failed",
      failureClass: "unknown",
      failureDetail: `merge step "${step}" has no task to act on`,
    };
  }

  // No catch around the step itself: the LINE is the error handling now. Its
  // `failed` edge routes forward, so a failing step is recorded and the ones
  // after it still run — which is the whole reason this stopped being one
  // function behind five try/catch blocks.
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
