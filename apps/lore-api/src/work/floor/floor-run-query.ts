// Lore's run-list filters spelled the floor's way: which floor lists to read, and what the floor cannot filter on is checked here on what it returned.
import type { RunFilter } from "@re-cinq/floor-client";
import { floorRepoOf } from "@re-cinq/lore-shared/floor/floor-items.js";
import { LOOP_LINE } from "@re-cinq/lore-shared/backlog/floor-loop.js";
import { floorTaskSubject } from "@re-cinq/lore-shared/floor/floor-task-runs.js";
import { floorPlanSubject } from "@re-cinq/lore-shared/feature-planning/floor-plan-runs.js";
import type {
  AssemblyRunQuery,
  AssemblyRunSummary,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";

const OPEN_STATUSES: readonly string[] = ["queued", "running"];

/** One floor list per line and open/finished half the query asks for, plus the lists a task's run may be in under another key; none when the floor holds nothing the query could match (it knows no cluster-agent claim). */
export function floorRunFilters(query: AssemblyRunQuery): RunFilter[] {
  if (query.clusterAgentId !== undefined) {
    return [];
  }
  const subject = subjectAsked(query);
  const repo =
    query.repo === undefined ? {} : { repo: floorRepoOf(query.repo) };
  const keyed = linesOf(query).flatMap((line) =>
    opensOf(query).map((open) => ({
      ...repo,
      ...(subject === undefined ? {} : { subject }),
      ...(line === undefined ? {} : { line }),
      open,
    })),
  );

  return [...keyed, ...keyedOtherwise(query, repo)];
}

/** The lines that keep a task but key their run on something else (the loop keys on the repository's backlog): a task's run there is read off the line's list and matched on the task it was started with. */
const TASK_LINES_KEYED_OTHERWISE: readonly string[] = [LOOP_LINE];

function keyedOtherwise(
  query: AssemblyRunQuery,
  repo: { repo?: string },
): RunFilter[] {
  if (query.taskId === undefined) {
    return [];
  }
  const lines = TASK_LINES_KEYED_OTHERWISE.filter((line) =>
    linesOf(query).some((asked) => asked === undefined || asked === line),
  );

  return lines.flatMap((line) =>
    opensOf(query).map((open) => ({ ...repo, line, open })),
  );
}

/** A task's runs are the ones keyed on it: a floor line that keeps a task makes `task_id` its subject. */
function subjectAsked(query: AssemblyRunQuery): string | undefined {
  if (query.taskId !== undefined) {
    return floorTaskSubject(query.taskId);
  }

  return query.subjectKey === undefined
    ? undefined
    : floorSubjectOf(query.subjectKey);
}

/** Lore's subject key spelled the floor's way. The floor keys a run `<subject argument>:<value>`, so a plan it holds is `plan_id:<id>` where Lore says `plan:<id>`; every other subject Lore asks about is already the floor's own spelling. Passed through unchanged, a plan's own run page and card would find nothing. */
function floorSubjectOf(subjectKey: string): string {
  const planId = subjectKey.startsWith(LORE_PLAN_SUBJECT)
    ? subjectKey.slice(LORE_PLAN_SUBJECT.length)
    : null;

  return planId === null ? subjectKey : floorPlanSubject(planId);
}

const LORE_PLAN_SUBJECT = "plan:";

/** What the floor's own filters leave open: the exact status (queued and running are both "open" there), the branch, the pull request and the start time. */
export function matchesFloorQuery(
  run: AssemblyRunSummary,
  query: AssemblyRunQuery,
): boolean {
  return (
    taskMatches(run, query) &&
    statusMatches(run, query) &&
    branchMatches(run, query) &&
    prMatches(run, query) &&
    startedAfter(run, query)
  );
}

function taskMatches(
  run: AssemblyRunSummary,
  query: AssemblyRunQuery,
): boolean {
  return query.taskId === undefined || run.taskId === query.taskId;
}

function statusMatches(
  run: AssemblyRunSummary,
  query: AssemblyRunQuery,
): boolean {
  return query.status === undefined || query.status.includes(run.status);
}

function branchMatches(
  run: AssemblyRunSummary,
  query: AssemblyRunQuery,
): boolean {
  return query.branch === undefined || run.branch === query.branch;
}

function prMatches(run: AssemblyRunSummary, query: AssemblyRunQuery): boolean {
  return (
    query.prNumber === undefined || run.args["pr_number"] === query.prNumber
  );
}

function startedAfter(
  run: AssemblyRunSummary,
  query: AssemblyRunQuery,
): boolean {
  return query.createdAfter === undefined || run.createdAt > query.createdAfter;
}

function linesOf(query: AssemblyRunQuery): (string | undefined)[] {
  const { blueprintName } = query;

  if (blueprintName === undefined) {
    return [undefined];
  }

  return typeof blueprintName === "string"
    ? [blueprintName]
    : [...blueprintName];
}

function opensOf(query: AssemblyRunQuery): boolean[] {
  const { status } = query;

  if (status === undefined) {
    return [true, false];
  }
  const statusOpenness = status.map(isOpenStatus);

  return [true, false].filter((open) => statusOpenness.includes(open));
}

function isOpenStatus(status: string): boolean {
  return OPEN_STATUSES.includes(status);
}
