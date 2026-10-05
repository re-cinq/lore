// Files a plan's story issue and task issues once: a rerun finds the ones already filed (by the marker each body ends with) and rewrites them, files only what's new, and closes the task issues the new decomposition dropped.

import type { createStationProject } from "@re-cinq/lore-shared/project/index.js";
import type {
  decideIssueWork,
  PlannedTask,
} from "@re-cinq/lore-shared/feature-planning/issue-work.js";
import {
  storyIssueBody,
  taskIssueBody,
  type StoryIssueInput,
} from "@re-cinq/lore-shared/feature-planning/issue-bodies.js";
import {
  findPlanIssues,
  storyMarker,
  taskMarker,
  withMarker,
  type PlanIssues,
} from "@re-cinq/lore-shared/feature-planning/plan-issues.js";
import { eventLine } from "@re-cinq/lore-assembly-lines";
import type { StationInput } from "@re-cinq/lore-shared/station-input.js";
import { taskInput, type FiledIssue } from "./spec-task-inputs.js";
import { partsNamed } from "@re-cinq/lore-shared/feature-planning/issue-coverage.js";
import type { SpecStatementLink } from "@re-cinq/lore-shared/feature-planning/issue-bodies.js";
import type { DecomposedSpec } from "./decomposed-spec.js";

export type StationProject = ReturnType<typeof createStationProject>;
export type ProceedWork = Extract<
  ReturnType<typeof decideIssueWork>,
  { outcome: "proceed" }
>;

export interface FilingContext {
  input: StationInput;
  story: StoryIssueInput;
  /** The plan the markers name; without one every run files afresh. */
  planId?: string;
  /** The spec the tasks name statements of; without one the issues cite none. */
  spec?: DecomposedSpec;
}

// Lore-filed issues of either state: a closed task issue still counts as filed, so a rerun doesn't file it again.
export async function existingPlanIssues(
  project: StationProject,
  planId: string | undefined,
): Promise<PlanIssues> {
  if (!planId) {
    return { tasks: new Map() };
  }
  const [open, closed] = await Promise.all(
    (["open", "closed"] as const).map((state) =>
      project.issues.list({ state, labels: ["lore-managed"] }),
    ),
  );

  return findPlanIssues([...open, ...closed], planId);
}

/** The story issue first (every task issue says what it is part of), then each task's issue in tasks.md order, then the dropped ones closed, the story rewritten to list the task issues, and the spec-tasks reconciled onto the open ones. */
export async function filePlanIssues(
  project: StationProject,
  work: ProceedWork,
  context: FilingContext,
): Promise<number> {
  const existing = await existingPlanIssues(project, context.planId);
  const storyNumber =
    existing.story?.number ?? (await fileStory(project, work, context));
  const filing = { context, existing, storyNumber };
  const taskIssues = await fileTasks(project, work.tasks, filing);

  await closeDropped(project, work.tasks, existing);
  await rewriteStory(project, work, { ...filing, taskIssues });
  await fileSpecTasks(project, work.tasks, { ...filing, taskIssues });

  return storyNumber;
}

// Its final form, listing the task issues; a story filed on an earlier run gets the plan's current title too.
async function rewriteStory(
  project: StationProject,
  work: ProceedWork,
  { context, existing, storyNumber, taskIssues }: FiledTasks,
): Promise<void> {
  await project.issues.update(storyNumber, {
    ...(existing.story ? { title: work.story.title } : {}),
    body: marked(
      storyIssueBody({ ...context.story, taskIssues: numbersOf(taskIssues) }),
      context.planId && storyMarker(context.planId),
    ),
  });
}

async function fileStory(
  project: StationProject,
  work: ProceedWork,
  context: FilingContext,
): Promise<number> {
  const issue = await project.issues.create(
    work.story.title,
    marked(
      storyIssueBody(context.story),
      context.planId && storyMarker(context.planId),
    ),
    work.story.labels,
  );

  console.log(eventLine(`filed story #${issue.number} ${work.story.title}`));

  return issue.number;
}

interface TaskFiling {
  context: FilingContext;
  existing: PlanIssues;
  storyNumber: number;
}

type FiledTasks = TaskFiling & {
  taskIssues: ReadonlyMap<string, FiledIssue>;
};

/** Every task's issue, answering task id → issue. Seeded with the issues already filed, so a task names a dependency filed on an earlier run even when tasks.md lists it later. */
async function fileTasks(
  project: StationProject,
  tasks: readonly PlannedTask[],
  filing: TaskFiling,
): Promise<Map<string, FiledIssue>> {
  const taskIssues = new Map<string, FiledIssue>(filing.existing.tasks);

  for (const planned of tasks) {
    taskIssues.set(
      planned.task.id,
      await fileTaskIssue(project, planned, { ...filing, taskIssues }),
    );
  }

  return taskIssues;
}

/** The task's issue: a closed one is left as it is, an open one rewritten, a new one filed as a sub-issue of the story. */
async function fileTaskIssue(
  project: StationProject,
  planned: PlannedTask,
  filing: FiledTasks,
): Promise<FiledIssue> {
  const filed = filedIssue(filing.existing, planned);

  if (filed?.state === "closed") {
    return filed;
  }
  const body = taskBody(planned, filing);

  if (filed) {
    await project.issues.update(filed.number, { title: planned.title, body });

    return filed;
  }

  return fileNewTaskIssue(project, { planned, body }, filing.storyNumber);
}

function filedIssue(existing: PlanIssues, { task }: PlannedTask) {
  return existing.tasks.get(task.id);
}

async function fileNewTaskIssue(
  project: StationProject,
  { planned, body }: { planned: PlannedTask; body: string },
  storyNumber: number,
): Promise<FiledIssue> {
  const issue = await project.issues.create(
    planned.title,
    body,
    planned.labels,
  );

  await project.issues.addSubIssue(storyNumber, issue.number);
  console.log(eventLine(`filed #${issue.number} ${planned.title}`));

  return issue;
}

function taskBody({ task }: PlannedTask, filing: FiledTasks): string {
  const { context, storyNumber, taskIssues } = filing;

  return marked(
    taskIssueBody({
      repo: context.input.repo,
      storyNumber,
      task,
      specStatements: statementsCited(context.spec, task.spec_lines ?? []),
      // A dependency with no issue yet (tasks.md out of order, first run) is named by its task id rather than dropped.
      dependsOn: task.depends_on.map((id) => taskIssues.get(id)?.number ?? id),
    }),
    context.planId && taskMarker(context.planId, task.id),
  );
}

function statementsCited(
  spec: DecomposedSpec | undefined,
  lines: readonly number[],
): SpecStatementLink[] {
  return spec
    ? partsNamed(spec.parts, lines).map(({ line, text }) => ({
        text,
        link: spec.linkOf(line),
      }))
    : [];
}

async function closeDropped(
  project: StationProject,
  tasks: readonly PlannedTask[],
  existing: PlanIssues,
): Promise<void> {
  const kept = new Set(tasks.map((planned) => planned.task.id));
  const dropped = [...existing.tasks]
    .filter(([id, issue]) => !kept.has(id) && issue.state === "open")
    .map(([, issue]) => issue.number);

  for (const number of dropped) {
    await project.issues.comment(
      number,
      "The plan was decomposed again and this task is no longer part of it.",
    );
    await project.issues.close(number, "not_planned");
  }
}

// Only a task whose issue is open gets a spec-task: a closed one is done (or abandoned), so its spec-task is left to the reconcile to cancel.
async function fileSpecTasks(
  project: StationProject,
  tasks: readonly PlannedTask[],
  filing: FiledTasks,
): Promise<void> {
  const { context, existing, storyNumber, taskIssues } = filing;
  const open = tasks.filter(
    (planned) => filedIssue(existing, planned)?.state !== "closed",
  );

  await project.tasks.reconcileSpecTasks({
    ...(context.planId ? { planId: context.planId } : {}),
    groupId: context.input.assembly_run_id,
    tasks: open.map((planned) =>
      taskInput(planned, context.input, {
        storyNumber,
        issue: taskIssues.get(planned.task.id) as FiledIssue,
      }),
    ),
  });
}

function numbersOf(
  taskIssues: ReadonlyMap<string, FiledIssue>,
): Map<string, number> {
  return new Map(
    [...taskIssues].map(([id, issue]) => [id, issue.number] as const),
  );
}

function marked(body: string, marker: string | undefined): string {
  return marker ? withMarker(body, marker) : body;
}
