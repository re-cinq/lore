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
  filePlanIssues,
  type FilingContext,
  type StationProject,
  type ProceedWork,
} from "../../planning/file-issues/plan-issue-filing.js";

export async function runVerifiedIssuesStation(
  input: StationInput,
  project: StationProject,
): Promise<NodeResult> {
  const prepared = await prepareFiling(input, project);
  const { actionable, context, original } = prepared;
  const work = context.nothingRemaining
    ? emptyWork(original, input.params.spec_path)
    : decideIssueWork(actionable, await project.issues.listLabels());

  if (work.outcome === "changes_requested") {
    return {
      outcome: "changes_requested",
      extras: { "Lore-Issues-Objection": work.objection },
    };
  }
  const number = await filePlanIssues(project, work, context);

  return filingResult(number, work, context);
}

async function prepareFiling(input: StationInput, project: StationProject) {
  const original = parseDecomposition(
    parseModelJson(input.params.feature_decomposition),
  );
  const actionable = actionableDecomposition(original, input.params.spec_path);
  const spec = await specOfRun(project, input, original);
  const context = filingContext(input, actionable, { uiUrl: undefined, spec });

  return {
    original,
    actionable,
    context: {
      ...context,
      ...completionContext(input, original),
      ...coverageContext(context, actionable, original),
    },
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

function emptyWork(
  decomposition: DecompositionResult,
  specPath: string,
): ProceedWork {
  const story = decomposition.stories.at(0);

  return {
    outcome: "proceed",
    story: { title: `User story: ${story?.title ?? specPath}`, labels: [] },
    tasks: [],
  };
}
