// Lore's run-list filters spelled the floor's way: which floor lists to read, and what the floor cannot filter on is checked here on what it returned.
import type { RunFilter } from "@re-cinq/floor-client";
import { floorRepoOf } from "@re-cinq/lore-shared/floor/floor-items.js";
import { floorTaskSubject } from "@re-cinq/lore-shared/floor/floor-task-runs.js";
import { floorPlanSubject } from "@re-cinq/lore-shared/feature-planning/floor-plan-runs.js";
import type {
  AssemblyRunQuery,
  AssemblyRunSummary,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";

const OPEN_STATUSES: readonly string[] = ["queued", "running"];

/** One floor list per line and open/finished half the query asks for; none when the floor holds nothing the query could match (it knows no cluster-agent claim). */
export function floorRunFilters(query: AssemblyRunQuery): RunFilter[] {
  if (query.clusterAgentId !== undefined) {
    return [];
  }
  const subject = subjectAsked(query);
  const shared = {
    ...(query.repo === undefined ? {} : { repo: floorRepoOf(query.repo) }),
    ...(subject === undefined ? {} : { subject }),
  };

  return linesOf(query).flatMap((line) =>
    opensOf(query).map((open) => ({
      ...shared,
      ...(line === undefined ? {} : { line }),
      open,
    })),
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
    statusMatches(run, query) &&
    branchMatches(run, query) &&
    prMatches(run, query) &&
    startedAfter(run, query)
  );
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
