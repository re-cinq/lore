// The spec-task each open task issue gets, as the reconcile files it.

import { taskIssueDetail } from "@re-cinq/lore-shared/feature-planning/decomposition-result.js";
import type { PlannedTask } from "@re-cinq/lore-shared/feature-planning/issue-work.js";
import type { ReconcileSpecTasksInput } from "@re-cinq/lore-shared/project/tasks/task-store-port.js";
import type { StationInput } from "@re-cinq/lore-shared/station-input.js";

export type FiledIssue = { number: number; url?: string };

export interface TaskIssues {
  storyNumber: number;
  issue: FiledIssue;
}

// One spec-task, on the issue it implements so its PR closes that issue. Written key by key rather than spread from the artifact: spreading published the agent's own vocabulary (`id`, no `feature_id`) instead of what every other producer/reader agrees on (`spec_task_id`) — the UI's `context_bundle->>'feature_id'` filter matched zero rows as a result. ADR-029's promise is that both producers share the row shape; this is what makes that true.
export function taskInput(
  planned: PlannedTask,
  input: StationInput,
  issues: TaskIssues,
): ReconcileSpecTasksInput["tasks"][number] {
  return {
    description: planned.description,
    taskType: "spec-task",
    createdBy: "issues-station",
    // The line IS the decomposition attempt, so its id groups the tasks it produced — stable across a re-drive of the same run, distinct for a genuine re-run.
    taskGroupId: input.assembly_run_id,
    issueNumber: issues.issue.number,
    ...(issues.issue.url ? { issueUrl: issues.issue.url } : {}),
    contextBundle: contextBundle(planned, input, issues),
  };
}

// What the spec-task carries about its place in the plan: its own id, what it waits on, its issue and the story issue above it, the detail its agent works from, and the plan and spec it came from — the merge-check flips that spec's status once the group is merged. Each is absent rather than null when the line carries none.
function contextBundle(
  planned: PlannedTask,
  input: StationInput,
  { storyNumber, issue }: TaskIssues,
) {
  const { task } = planned;

  return {
    spec_task_id: task.id,
    depends_on: task.depends_on,
    parallelizable: task.parallelizable,
    phase: task.phase,
    ...(task.file_path ? { file_path: task.file_path } : {}),
    ...(task.labels ? { labels: task.labels } : {}),
    ...taskIssueDetail(task),
    story_issue: storyNumber,
    task_issue: issue.number,
    assembly_line_id: input.assembly_run_id,
    ...planPlace(input.params),
  };
}

// The plan and spec a spec-task came from, each only when the line carries it.
function planPlace(params: StationInput["params"]) {
  const { plan_id: planId, spec_path: specPath } = params;
  const specSlug = specSlugOf(specPath);

  return {
    ...(planId ? { plan_id: planId } : {}),
    ...(specPath ? { spec_path: specPath } : {}),
    ...(specSlug ? { spec_slug: specSlug } : {}),
  };
}

// The spec's directory under specs/ — what the tasks.md sync stamps, and what the spec-task dependency check pairs a task with its prerequisites on; without it a task with any depends_on never became ready.
export function specSlugOf(specPath: string | undefined): string | undefined {
  return specPath?.match(/^specs\/([^/]+)/)?.[1];
}
