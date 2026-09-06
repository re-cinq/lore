// The issues station: files the GitHub Issues and spec-tasks a decomposition calls for. Deterministic — the judgement (which stories, which labels) already happened upstream in decompose, and this only writes what the artifact says. It's also the first thing to read that artifact as DATA rather than prose, so a bad label sends the decomposition back (`changes_requested` re-runs decompose against the objection, specs/6-dark-factory FR6.18) rather than being dropped or failing the line.

import { createStationProject } from "@re-cinq/lore-shared/project/index.js";
import {
  decideIssueWork,
  type PlannedIssue,
  type PlannedTask,
} from "@re-cinq/lore-shared/feature-planning/issue-work.js";
import {
  parseDecomposition,
  type DecompositionResult,
} from "@re-cinq/lore-shared/feature-planning/decomposition-result.js";
import { parseModelJson } from "@re-cinq/lore-shared/feature-planning/model-json.js";
import { eventLine, type NodeResult } from "@re-cinq/lore-assembly-lines";
import type { StationInput } from "@re-cinq/lore-shared/station-input.js";

export interface IssuesStationDeps {
  /** Injectable project for tests; defaults to the pod's HTTP facade. */
  project?: ReturnType<typeof createStationProject>;
}

// Files one Issue per story and one spec-task per task. The decomposition rides in on `params.feature_decomposition` — the artifact decompose produced, merged into the line's args by the Floor; a run reaching here without it is a wiring failure, not a bad decomposition, so it fails rather than asking the agent to fix something it did nothing wrong about.
export async function runIssuesStation(
  input: StationInput,
  deps: IssuesStationDeps = {},
): Promise<NodeResult> {
  const raw = input.params.feature_decomposition;

  if (!raw) {
    console.log(
      eventLine(
        "no decomposition reached this node — the artifact was never merged into the line",
      ),
    );

    return { outcome: "failed" };
  }
  const project = deps.project ?? createStationProject(input.repo);
  const decomposition = parseDecomposition(parseModelJson(raw));
  const work = decideIssueWork(
    decomposition,
    await project.issues.listLabels(),
  );

  if (work.outcome === "changes_requested") {
    console.log(eventLine(`rework: ${work.objection}`));

    return {
      outcome: "changes_requested",
      extras: { "Lore-Issues-Objection": work.objection },
    };
  }
  const filed = await fileStoryIssues(project, decomposition, work.issues);

  await createSpecTasks(project, work.tasks, input, filed);

  return {
    outcome: "success",
    extras: {
      "Lore-Issues": String(filed.length),
      "Lore-Spec-Tasks": String(work.tasks.length),
    },
  };
}

type StationProject = ReturnType<typeof createStationProject>;

/** Files one Issue per story, in order, returning the filed issue numbers by story index. */
async function fileStoryIssues(
  project: StationProject,
  decomposition: DecompositionResult,
  issues: readonly PlannedIssue[],
): Promise<number[]> {
  const filed: number[] = [];

  for (const issue of issues) {
    const created = await project.issues.create(
      issue.title,
      storyBody(decomposition.stories[issue.storyIndex]),
      issue.labels,
    );

    filed.push(created.number);
    console.log(eventLine(`filed #${created.number} ${issue.title}`));
  }

  return filed;
}

/** Files one spec-task per planned task, each linked back to the story Issue it implements. */
async function createSpecTasks(
  project: StationProject,
  tasks: readonly PlannedTask[],
  input: StationInput,
  filed: number[],
): Promise<void> {
  for (const planned of tasks) {
    await project.tasks.create(taskInput(planned, input, filed));
  }
}

/** The Issue body: what the story is, and what has to be true for it to be done. */
function storyBody(story: {
  summary: string;
  acceptance_criteria: string[];
}): string {
  const criteria = story.acceptance_criteria
    .map((c) => `- [ ] ${c}`)
    .join("\n");

  return `${story.summary}\n\n## Acceptance criteria\n\n${criteria}\n`;
}

// One spec-task, carrying the story Issue it implements so the work is traceable back to its user-facing slice. Written key by key rather than spread from the artifact: spreading published the agent's own vocabulary (`id`, no `feature_id`) instead of what every other producer/reader agrees on (`spec_task_id`) — the UI's `context_bundle->>'feature_id'` filter matched zero rows as a result. ADR-029's promise is that both producers share the row shape; this is what makes that true.
function taskInput(
  planned: PlannedTask,
  input: StationInput,
  filed: number[],
): Parameters<ReturnType<typeof createStationProject>["tasks"]["create"]>[0] {
  const featureId = input.params.feature_id;

  return {
    description: planned.description,
    taskType: "spec-task",
    targetRepo: input.repo,
    createdBy: "issues-station",
    // The line IS the decomposition attempt, so its id groups the tasks it produced — stable across a re-drive of the same run, distinct for a genuine re-run.
    taskGroupId: input.assembly_run_id,
    contextBundle: {
      spec_task_id: planned.task.id,
      depends_on: planned.task.depends_on,
      parallelizable: planned.task.parallelizable,
      phase: planned.task.phase,
      ...(planned.task.file_path ? { file_path: planned.task.file_path } : {}),
      ...(planned.task.labels ? { labels: planned.task.labels } : {}),
      story_issue: filed[planned.storyIndex],
      assembly_line_id: input.assembly_run_id,
      // Absent rather than null when the line carries no feature: the UI filter is a JSON text match, and a literal "null" would match nothing while looking set.
      ...(featureId ? { feature_id: featureId } : {}),
    },
  };
}
