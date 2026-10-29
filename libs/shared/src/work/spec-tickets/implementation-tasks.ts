import type {
  DecompositionResult,
  DecompTask,
  StatementAssessment,
  SpecLine,
} from "../../domain/feature-planning/decomposition-result.js";
import type { ImplementationEvidence } from "../../domain/feature-planning/grounding.js";

export type VerifyEvidence = (
  evidence: ImplementationEvidence,
) => Promise<boolean>;

export async function taskErrors(
  decomposition: DecompositionResult,
  statements: StatementAssessment[],
  specPath: string,
  verify: VerifyEvidence,
): Promise<string[]> {
  const tasks = decomposition.stories.flatMap((story) => story.tasks);
  const objections = await Promise.all(
    tasks.map((task) => taskObjections(task, statements, specPath, verify)),
  );

  return objections.flat();
}

async function taskObjections(
  task: DecompTask,
  statements: readonly StatementAssessment[],
  specPath: string,
  verify: VerifyEvidence,
): Promise<string[]> {
  const named = statementsForTask(task, statements, specPath);
  const inPlace = task.in_place ?? [];
  const verified = await Promise.all(
    inPlace.map(
      async (entry) =>
        namesImplementedStatement(entry, named) && (await verify(entry)),
    ),
  );

  return [
    ...partialObjection(task, named, verified),
    ...scopeObjections(task, named, specPath),
  ];
}

function scopeObjections(
  task: DecompTask,
  named: readonly StatementAssessment[],
  specPath: string,
): string[] {
  return [
    ...lineObjection(task, named, specPath),
    ...fullScopeObjection(task, named),
    ...completionObjection(task, named),
  ];
}

function completionObjection(
  task: DecompTask,
  named: readonly StatementAssessment[],
): string[] {
  const present =
    named.length > 0 &&
    named.every((statement) => statement.status === "present");

  return present && task.remaining
    ? [
        `${task.id}: remaining work conflicts with present statements; classify the gap as partial, or remove remaining only when no work remains.`,
      ]
    : [];
}

function lineObjection(
  task: DecompTask,
  named: readonly StatementAssessment[],
  specPath: string,
): string[] {
  return task.spec_lines?.length !== named.length || named.length === 0
    ? [
        `${task.id}: spec_lines must name exact starting lines of statements in ${specPath}.`,
      ]
    : [];
}

function namesImplementedStatement(
  entry: SpecLine,
  statements: readonly StatementAssessment[],
): boolean {
  return statements.some(
    (statement) =>
      statement.file === entry.file &&
      statement.line === entry.line &&
      statement.status !== "missing",
  );
}

function partialObjection(
  task: DecompTask,
  named: readonly StatementAssessment[],
  verified: readonly boolean[],
): string[] {
  const invalidEvidence = verified.some((valid) => !valid);
  const incompleteGap = isPartial(named) && !hasGapDetails(task, verified);

  return invalidEvidence || incompleteGap
    ? [
        `${task.id}: partial work requires verified in_place evidence, remaining, changes, acceptance_criteria and test_plan for the gap; otherwise restore the full missing task.`,
      ]
    : [];
}

function isPartial(named: readonly StatementAssessment[]): boolean {
  const statuses = new Set(named.map((statement) => statement.status));

  return (
    statuses.has("partial") ||
    (statuses.has("present") && statuses.has("missing"))
  );
}

function hasGapDetails(
  task: DecompTask,
  verified: readonly boolean[],
): boolean {
  return [
    verified.length > 0,
    task.remaining,
    task.changes,
    task.acceptance_criteria?.length,
    task.test_plan,
  ].every(Boolean);
}

function fullScopeObjection(
  task: DecompTask,
  named: readonly StatementAssessment[],
): string[] {
  const narrowed = Boolean(task.remaining || task.in_place?.length);
  const missing = named.every((statement) => statement.status === "missing");

  return narrowed && missing
    ? [
        `${task.id}: no implementation evidence remains verified; remove in_place and remaining and restore the full task scope.`,
      ]
    : [];
}

export function statementsForTask(
  task: DecompTask,
  statements: readonly StatementAssessment[],
  specPath: string,
): StatementAssessment[] {
  return statements.filter((statement) =>
    (task.spec_lines ?? []).some(
      (cited) =>
        (cited.file ?? specPath) === statement.file &&
        cited.line === statement.line,
    ),
  );
}

export function completedTask(
  task: DecompTask,
  decomposition: DecompositionResult,
  specPath: string,
): boolean {
  const cited = task.spec_lines ?? [];
  const statements = decomposition.statements ?? [];
  const named = statementsForTask(task, statements, specPath);
  const present = new Set(
    named
      .filter((statement) => statement.status === "present")
      .map((statement) => statementKey(statement, specPath)),
  );

  return (
    cited.length > 0 &&
    cited.every((line) => present.has(statementKey(line, specPath)))
  );
}

function statementKey(statement: SpecLine, specPath: string): string {
  return `${statement.file ?? specPath}:${statement.line}`;
}

export function completedTasks(
  decomposition: DecompositionResult,
  specPath: string,
): DecompTask[] {
  const tasks = decomposition.stories.flatMap((story) => story.tasks);

  return tasks.filter((task) => completedTask(task, decomposition, specPath));
}

export function actionableDecomposition(
  decomposition: DecompositionResult,
  specPath: string,
): DecompositionResult {
  const completed = new Set(
    completedTasks(decomposition, specPath).map((task) => task.id),
  );
  const stories = decomposition.stories.map((story) => ({
    ...story,
    tasks: story.tasks.filter((task) => !completed.has(task.id)),
  }));

  return {
    ...decomposition,
    stories: stories.filter((story) => story.tasks.length > 0),
  };
}

export function presentStatements(
  decomposition: DecompositionResult,
): SpecLine[] {
  const statements = decomposition.statements ?? [];

  return statements
    .filter((statement) => statement.status === "present")
    .map(({ file, line }) => ({ file, line }));
}
