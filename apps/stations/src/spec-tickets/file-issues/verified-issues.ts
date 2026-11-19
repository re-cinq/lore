import type { PlanIssues } from "@re-cinq/lore-shared/feature-planning/plan-issues.js";
import type { NodeResult } from "@re-cinq/lore-assembly-lines";
import {
  parseDecomposition,
  type DecompositionResult,
} from "@re-cinq/lore-shared/feature-planning/decomposition-result.js";
import { parseModelJson } from "@re-cinq/lore-shared/feature-planning/model-json.js";
import { decideIssueWork } from "@re-cinq/lore-shared/feature-planning/issue-work.js";
import {
  actionableDecomposition,
  completedTasks,
  presentStatements,
} from "@re-cinq/lore-shared/spec-tickets/implementation-tasks.js";
import {
  issueCoverage,
  issueCoverageBrief,
} from "@re-cinq/lore-shared/feature-planning/issue-coverage.js";
import type { StationInput } from "@re-cinq/lore-shared/station-input.js";
import { filingContext, specOfRun } from "../../planning/file-issues/issues.js";
import {
  existingPlanIssues,
  filePlanIssues,
  type FilingContext,
  type StationProject,
  type ProceedWork,
} from "../../planning/file-issues/plan-issue-filing.js";

export async function runVerifiedIssuesStation(
  input: StationInput,
  project: StationProject,
  verified?: DecompositionResult,
): Promise<NodeResult> {
  const existing = await existingPlanIssues(project, input.params.filing_key);
  const tasks = filingTasks(input, existing, verified);
  const context = await prepareFiling(input, project, tasks);
  const work = await tasksToIssues(project, tasks, context);

  if (work.outcome === "changes_requested") {
    return {
      outcome: "changes_requested",
      extras: { "Lore-Issues-Objection": work.objection },
    };
  }
  const number = await filePlanIssues(project, work, context, existing);

  return filingResult(number, work, context);
}

interface FilingTasks {
  original: DecompositionResult;
  actionable: DecompositionResult;
  filing: DecompositionResult;
}

function filingTasks(
  input: StationInput,
  existing: PlanIssues,
  verified?: DecompositionResult,
): FilingTasks {
  const deduped = parseDecomposition(
    parseModelJson(input.params.feature_decomposition),
  );
  const original = verified ?? deduped;
  const actionable = actionableDecomposition(original, input.params.spec_path);
  const filing = verified
    ? tasksForFiling(actionable, deduped, existing.tasks)
    : actionable;

  return { original, actionable, filing };
}

async function tasksToIssues(
  project: StationProject,
  { filing, actionable }: FilingTasks,
  context: FilingContext,
) {
  const { input, nothingRemaining } = context;
  const planTitle = input.params.plan_title;
  const heldByOtherTickets =
    filing.stories.length === 0 && actionable.stories.length > 0;

  return nothingRemaining || heldByOtherTickets
    ? emptyWork(planTitle)
    : decideIssueWork(filing, await project.issues.listLabels(), { planTitle });
}

// Reconcile against the same owned issues the writer will update or close.
function tasksForFiling(
  verified: DecompositionResult,
  deduped: DecompositionResult,
  owned: PlanIssues["tasks"],
): DecompositionResult {
  const fileable = deduped.stories.flatMap((story) => story.tasks);
  const kept = new Map(fileable.map((task) => [task.id, task]));
  const stories = verified.stories.map((story) => {
    const retained = story.tasks.filter(
      (task) => kept.has(task.id) || owned.has(task.id),
    );
    const tasks = retained.map((task) => kept.get(task.id) ?? task);

    return { ...story, tasks };
  });

  return {
    ...verified,
    stories: stories.filter((story) => story.tasks.length > 0),
  };
}

async function prepareFiling(
  input: StationInput,
  project: StationProject,
  { original, actionable, filing }: FilingTasks,
) {
  const spec = await specOfRun(project, input, original);
  const context = filingContext(input, filing, { uiUrl: undefined, spec });

  return {
    ...context,
    ...completionContext(input, original),
    ...coverageContext(context, actionable, original),
  };
}

function completionContext(input: StationInput, original: DecompositionResult) {
  const completed = completedTasks(original, input.params.spec_path);

  return {
    completed,
    completedIds: new Set(completed.map((task) => task.id)),
    commit: original.spec_commit,
    statements: original.statements,
  };
}

function coverageContext(
  context: FilingContext,
  actionable: DecompositionResult,
  original: DecompositionResult,
) {
  const { spec } = context;
  const tasks = actionable.stories.flatMap((story) => story.tasks);
  const options = { implementationVerified: true };
  const covered = spec
    ? issueCoverage(spec.specs, tasks, presentStatements(original))
    : undefined;
  const coverage =
    covered && spec
      ? issueCoverageBrief(covered, spec.linkOf, options)
      : undefined;

  return {
    nothingRemaining: tasks.length === 0 && covered?.missing.length === 0,
    story: { ...context.story, coverage },
  };
}

function filingResult(
  number: number,
  work: ProceedWork,
  context: FilingContext,
): NodeResult {
  const extras: Record<string, string> = context.nothingRemaining
    ? { "Lore-Issues": "0", "Lore-Issues-Result": "nothing to ticket" }
    : {
        "Lore-Story-Issue": String(number),
        "Lore-Issues": String(1 + work.tasks.length),
      };

  return { outcome: "success", extras };
}

function emptyWork(planTitle: string): ProceedWork {
  return {
    outcome: "proceed",
    story: { title: `User story: ${planTitle}`, labels: [] },
    tasks: [],
  };
}
