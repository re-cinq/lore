// The issues station: files a plan's ONE story issue and one issue per task, each a native sub-issue of the story, and the spec-task that implements each task issue. Deterministic — the judgement (which slices, which tasks, what each task needs) already happened upstream in decompose, and this only writes what the artifact says. It's also the first thing to read that artifact as DATA rather than prose, so a bad label sends the decomposition back (`changes_requested` re-runs decompose against the objection, specs/6-dark-factory FR6.18) rather than being dropped or failing the line.

import { createStationProject } from "@re-cinq/lore-shared/project/index.js";
import {
  decideIssueWork,
  type PlannedTask,
} from "@re-cinq/lore-shared/feature-planning/issue-work.js";
import {
  storyIssueBody,
  taskIssueBody,
  type StoryIssueInput,
} from "@re-cinq/lore-shared/feature-planning/issue-bodies.js";
import {
  parseDecomposition,
  taskIssueDetail,
  type DecompositionResult,
} from "@re-cinq/lore-shared/feature-planning/decomposition-result.js";
import { parseModelJson } from "@re-cinq/lore-shared/feature-planning/model-json.js";
import { eventLine, type NodeResult } from "@re-cinq/lore-assembly-lines";
import type { StationInput } from "@re-cinq/lore-shared/station-input.js";

export interface IssuesStationDeps {
  /** Injectable project for tests; defaults to the pod's HTTP facade. */
  project?: ReturnType<typeof createStationProject>;
  /** The web UI's base address, for the story issue's plan link; defaults to `LORE_UI_URL`. */
  uiUrl?: string;
}

type StationProject = ReturnType<typeof createStationProject>;
type ProceedWork = Extract<
  ReturnType<typeof decideIssueWork>,
  { outcome: "proceed" }
>;
type FiledIssue = { number: number; url?: string };

// The decomposition rides in on `params.feature_decomposition` — the artifact decompose produced, merged into the line's args by the Floor; a run reaching here without it is a wiring failure, not a bad decomposition, so it fails rather than asking the agent to fix something it did nothing wrong about.
export async function runIssuesStation(
  input: StationInput,
  deps: IssuesStationDeps = {},
): Promise<NodeResult> {
  const raw = input.params.feature_decomposition;

  if (!raw) {
    return missingDecomposition();
  }
  const project = deps.project ?? createStationProject(input.repo);
  const decomposition = parseDecomposition(parseModelJson(raw));
  const work = await planWork(project, decomposition, input);

  if (work.outcome === "changes_requested") {
    return rework(work.objection);
  }

  return fileWork(project, work, {
    input,
    story: storyInput(input, decomposition, deps.uiUrl),
  });
}

async function planWork(
  project: StationProject,
  decomposition: DecompositionResult,
  input: StationInput,
) {
  return decideIssueWork(
    decomposition,
    await project.issues.listLabels(),
    input.params.plan_title,
  );
}

// A run reaching this node with no decomposition is a WIRING failure, not a bad decomposition — so it fails rather than routing to rework, which would ask the agent to fix something it did nothing wrong about.
function missingDecomposition(): NodeResult {
  console.log(
    eventLine(
      "no decomposition reached this node — the artifact was never merged into the line",
    ),
  );

  return { outcome: "failed" };
}

// The decomposition is readable but not fileable. The objection rides in extras so the agent that produced it gets told what to change.
function rework(objection: string): NodeResult {
  console.log(eventLine(`rework: ${objection}`));

  return {
    outcome: "changes_requested",
    extras: { "Lore-Issues-Objection": objection },
  };
}

/** What the story issue's body is built from; the task issue numbers join it once they exist. */
function storyInput(
  input: StationInput,
  decomposition: DecompositionResult,
  uiUrl = process.env.LORE_UI_URL,
): StoryIssueInput {
  const { plan_id: planId, plan_title: planTitle } = input.params;
  const specSlug = specSlugOf(input.params.spec_path);

  return {
    repo: input.repo,
    stories: decomposition.stories,
    ...(planTitle ? { planTitle } : {}),
    ...planUrlOf(uiUrl, input.repo, planId),
    ...(specSlug ? { specSlug } : {}),
  };
}

function planUrlOf(
  uiUrl: string | undefined,
  repo: string,
  planId: string | undefined,
): { planUrl?: string } {
  return uiUrl && planId
    ? { planUrl: `${uiUrl.replace(/\/+$/, "")}/repos/${repo}/plans/${planId}` }
    : {};
}

interface FilingContext {
  input: StationInput;
  story: StoryIssueInput;
}

/** The story issue first (every task issue says what it is part of), then each task's issue, its sub-issue link and its spec-task, in tasks.md order so a dependency is filed before the task that waits on it; last, the story is rewritten to list the task issues. */
async function fileWork(
  project: StationProject,
  work: ProceedWork,
  context: FilingContext,
): Promise<NodeResult> {
  const storyNumber = await fileStory(project, work.story, context.story);
  const taskIssues = await fileTasks(project, work.tasks, {
    context,
    storyNumber,
  });

  await project.issues.updateBody(
    storyNumber,
    storyIssueBody({ ...context.story, taskIssues }),
  );

  return filed(storyNumber, work.tasks.length);
}

async function fileStory(
  project: StationProject,
  story: ProceedWork["story"],
  body: StoryIssueInput,
): Promise<number> {
  const issue = await project.issues.create(
    story.title,
    storyIssueBody(body),
    story.labels,
  );

  console.log(eventLine(`filed story #${issue.number} ${story.title}`));

  return issue.number;
}

/** Every task's issue in order, answering task id → issue number so later tasks name their dependencies by issue. */
async function fileTasks(
  project: StationProject,
  tasks: readonly PlannedTask[],
  filing: Omit<TaskFiling, "taskIssues">,
): Promise<Map<string, number>> {
  const taskIssues = new Map<string, number>();

  for (const planned of tasks) {
    const issue = await fileTask(project, planned, { ...filing, taskIssues });

    taskIssues.set(planned.task.id, issue.number);
  }

  return taskIssues;
}

function filed(storyNumber: number, taskCount: number): NodeResult {
  return {
    outcome: "success",
    extras: {
      "Lore-Story-Issue": String(storyNumber),
      "Lore-Issues": String(1 + taskCount),
      "Lore-Spec-Tasks": String(taskCount),
    },
  };
}

interface TaskFiling {
  context: FilingContext;
  storyNumber: number;
  taskIssues: ReadonlyMap<string, number>;
}

/** One task's issue, linked under the story, and the spec-task that implements it. */
async function fileTask(
  project: StationProject,
  planned: PlannedTask,
  filing: TaskFiling,
): Promise<FiledIssue> {
  const issue = await fileTaskIssue(project, planned, filing);

  await project.tasks.create(
    taskInput(planned, filing.context.input, {
      storyNumber: filing.storyNumber,
      issue,
    }),
  );
  console.log(eventLine(`filed #${issue.number} ${planned.title}`));

  return issue;
}

/** The task's issue, a native sub-issue of the story. */
async function fileTaskIssue(
  project: StationProject,
  { task, title, labels }: PlannedTask,
  { context, storyNumber, taskIssues }: TaskFiling,
): Promise<FiledIssue> {
  const body = taskIssueBody({
    repo: context.input.repo,
    storyNumber,
    task,
    dependsOn: dependencyIssues(task.depends_on, taskIssues),
  });
  const issue = await project.issues.create(title, body, labels);

  await project.issues.addSubIssue(storyNumber, issue.number);

  return issue;
}

// A dependency filed later than its dependent (tasks.md out of order) has no number yet, so it is named by its task id rather than dropped.
function dependencyIssues(
  dependsOn: readonly string[],
  taskIssues: ReadonlyMap<string, number>,
): (number | string)[] {
  return dependsOn.map((id) => taskIssues.get(id) ?? id);
}

interface TaskIssues {
  storyNumber: number;
  issue: FiledIssue;
}

// One spec-task, on the issue it implements so its PR closes that issue. Written key by key rather than spread from the artifact: spreading published the agent's own vocabulary (`id`, no `feature_id`) instead of what every other producer/reader agrees on (`spec_task_id`) — the UI's `context_bundle->>'feature_id'` filter matched zero rows as a result. ADR-029's promise is that both producers share the row shape; this is what makes that true.
function taskInput(
  planned: PlannedTask,
  input: StationInput,
  issues: TaskIssues,
): Parameters<StationProject["tasks"]["create"]>[0] {
  return {
    description: planned.description,
    taskType: "spec-task",
    targetRepo: input.repo,
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
function specSlugOf(specPath: string | undefined): string | undefined {
  return specPath?.match(/^specs\/([^/]+)/)?.[1];
}
