// Shared dependency-ordering check for blocked-reason and approve-merge (specs/protected-branch-merge).
import { loreTaskIdOf, type PipelineTask } from "@re-cinq/lore-shared";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";

export interface DependencyPort {
  getTaskDependsOn(taskId: string): Promise<string[]>;
  getTaskPr(taskId: string): Promise<number | null>;
}

export interface PullReader {
  get(
    prNumber: number,
  ): Promise<{ state: string; mergedAt?: string; createdAt?: string } | null>;
  list?(
    state?: "open" | "closed" | "all",
  ): Promise<
    Pick<
      PullRef,
      "number" | "state" | "body" | "author" | "draft" | "createdAt"
    >[]
  >;
}

export interface TaskReader {
  getById(id: string): Promise<PipelineTask | null>;
  list(
    status?: string,
    limit?: number,
  ): Promise<{ tasks: Pick<PipelineTask, "id">[] }>;
}

export interface TaskPrLookup {
  prInfo(taskId: string): Promise<{ pr_number: number | null } | null>;
}

export interface TaskGroupRef {
  task_group_id: string;
  depends_on?: number[];
}

export interface DependencyProject extends Partial<DependencyPort> {
  taskGroup?(prNumber: number): Promise<TaskGroupRef | undefined>;
}

export async function resolveBlockingDependency(
  project: DependencyProject,
  pulls: PullReader,
  pr: Pick<PullRef, "number" | "body">,
): Promise<number | null> {
  const tgBlocker = await taskGroupBlocker(project, pulls, pr.number);

  return (
    tgBlocker ?? blockingDependencyPrOpt(project, pulls, pr.number, pr.body)
  );
}

async function taskGroupBlocker(
  project: DependencyProject,
  pulls: PullReader,
  prNumber: number,
): Promise<number | null> {
  const tg = await project.taskGroup?.(prNumber);
  const numbers = tg?.depends_on ?? [];
  const prs = await Promise.all(numbers.map((n) => pulls.get(n)));
  const index = prs.findIndex((p) => p != null && isUnmergedState(p));

  return numbers[index] ?? null;
}

export function createDependencyPort(
  tasks: TaskReader,
  queue: TaskPrLookup,
): DependencyPort {
  return {
    getTaskDependsOn: (taskId) => resolveTaskDependsOn(tasks, taskId),
    getTaskPr: async (taskId) =>
      (await queue.prInfo(taskId))?.pr_number ?? null,
  };
}

async function resolveTaskDependsOn(
  tasks: TaskReader,
  taskId: string,
): Promise<string[]> {
  const task = await tasks.getById(taskId);

  if (!task) {
    return [];
  }

  const refs = rawDependsOn(task);
  const explicit = await mapGroupDependencies(tasks, task.task_group_id, refs);
  const older = await olderIndependentSiblings(tasks, task, explicit);

  return [...explicit, ...older];
}

function rawDependsOn(task: PipelineTask | null): string[] {
  const raw = task?.context_bundle?.depends_on;

  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter((ref): ref is string => typeof ref === "string");
}

async function mapGroupDependencies(
  tasks: TaskReader,
  groupId: string | null | undefined,
  refs: string[],
): Promise<string[]> {
  if (!groupId || refs.length === 0) {
    return refs;
  }

  const siblings = await groupSiblings(tasks, groupId);

  return refs.map((ref) => matchSiblingId(siblings, ref) ?? ref);
}

async function olderIndependentSiblings(
  tasks: TaskReader,
  task: PipelineTask,
  explicit: string[],
): Promise<string[]> {
  if (!task.task_group_id || !task.created_at) {
    return [];
  }

  const siblings = await groupSiblings(tasks, task.task_group_id);

  return siblings
    .filter((sib) => isOlderIndependent(sib, task, siblings, explicit))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((sib) => sib.id);
}

function isOlderIndependent(
  sib: PipelineTask,
  task: PipelineTask,
  siblings: PipelineTask[],
  explicit: string[],
): boolean {
  const isOlder = sib.id !== task.id && sib.created_at < task.created_at;

  return (
    isOlder &&
    !explicit.includes(sib.id) &&
    !siblingDependsOn(sib, task, siblings)
  );
}

function siblingDependsOn(
  sib: PipelineTask,
  target: PipelineTask,
  siblings: PipelineTask[],
): boolean {
  const resolved = rawDependsOn(sib).map(
    (ref) => matchSiblingId(siblings, ref) ?? ref,
  );

  return resolved.includes(target.id);
}

async function groupSiblings(
  tasks: TaskReader,
  groupId: string,
): Promise<PipelineTask[]> {
  const { tasks: listed } = await tasks.list(undefined, 200);
  const full = await Promise.all(listed.map((row) => tasks.getById(row.id)));

  return full.filter(
    (row): row is PipelineTask => row != null && row.task_group_id === groupId,
  );
}

function matchSiblingId(
  siblings: PipelineTask[],
  ref: string,
): string | undefined {
  return siblings.find(
    (row) => row.id === ref || row.context_bundle?.spec_task_id === ref,
  )?.id;
}

export function blockingDependencyPrOpt(
  port: Partial<DependencyPort>,
  pulls: PullReader,
  prNumber: number,
  body: string | null | undefined,
): Promise<number | null> {
  const { getTaskDependsOn, getTaskPr } = port;

  if (!getTaskDependsOn || !getTaskPr) {
    return Promise.resolve(null);
  }

  return blockingDependencyPr(
    {
      getTaskDependsOn: getTaskDependsOn.bind(port),
      getTaskPr: getTaskPr.bind(port),
    },
    pulls,
    prNumber,
    body,
  );
}

export async function blockingDependencyPr(
  deps: DependencyPort,
  pulls: PullReader,
  prNumber: number,
  body: string | null | undefined,
): Promise<number | null> {
  const taskId = loreTaskIdOf(body);

  if (!taskId) {
    return null;
  }

  const dependsOn = await deps.getTaskDependsOn(taskId);

  return findFirstBlocker(pulls, prNumber, dependsOn, deps.getTaskPr);
}

async function findFirstBlocker(
  pulls: PullReader,
  prNumber: number,
  depTaskIds: string[],
  getTaskPr: (id: string) => Promise<number | null>,
): Promise<number | null> {
  for (const depTaskId of depTaskIds) {
    const depPrNumber = await getTaskPr(depTaskId);

    if (await isUnmergedDep(pulls, prNumber, depPrNumber)) {
      return depPrNumber;
    }
  }

  return null;
}

async function isUnmergedDep(
  pulls: PullReader,
  prNumber: number,
  depPrNumber: number | null,
): Promise<boolean> {
  if (depPrNumber == null || depPrNumber === prNumber) {
    return false;
  }

  const depPr = await pulls.get(depPrNumber);

  return depPr != null && isUnmergedState(depPr);
}

function isUnmergedState(depPr: { state: string; mergedAt?: string }): boolean {
  return depPr.state === "open" || !depPr.mergedAt;
}

export async function dependentOpenPulls<T extends PullRef>(
  deps: Partial<DependencyPort>,
  openPulls: readonly T[],
  closedPulls: readonly (Pick<PullRef, "number" | "body"> | null)[],
): Promise<T[]> {
  const { getTaskDependsOn } = deps;

  if (!getTaskDependsOn) {
    return [];
  }

  const closedTaskIds = closedIdsOf(closedPulls);

  return closedTaskIds.size > 0
    ? filterDependents(openPulls, closedTaskIds, getTaskDependsOn.bind(deps))
    : [];
}

function closedIdsOf(
  closedPulls: readonly (Pick<PullRef, "number" | "body"> | null)[],
): Set<string> {
  const ids = closedPulls
    .map((pr) => loreTaskIdOf(pr?.body))
    .filter((id): id is string => id !== null);

  return new Set(ids);
}

async function filterDependents<T extends PullRef>(
  openPulls: readonly T[],
  closedTaskIds: Set<string>,
  getTaskDependsOn: (taskId: string) => Promise<string[]>,
): Promise<T[]> {
  const matched: T[] = [];

  for (const pr of openPulls) {
    if (await dependsOnAnyTask(pr, closedTaskIds, getTaskDependsOn)) {
      matched.push(pr);
    }
  }

  return matched;
}

async function dependsOnAnyTask(
  pr: PullRef,
  closedTaskIds: Set<string>,
  getTaskDependsOn: (taskId: string) => Promise<string[]>,
): Promise<boolean> {
  const taskId = loreTaskIdOf(pr.body);

  if (!taskId) {
    return false;
  }

  const depIds = await getTaskDependsOn(taskId);

  return depIds.some((id) => closedTaskIds.has(id));
}
