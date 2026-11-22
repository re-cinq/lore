// A spec statement naming a path this repository does not hold, or a retired part of Lore, describes code that lives elsewhere or is gone: a ticket for it is work the implementation loop can never do, so spec-tickets files none and reports the statement as drift.

import type {
  DecompTask,
  DecompositionResult,
} from "../../domain/feature-planning/decomposition-result.js";
import { groundingFindings } from "../../domain/feature-planning/grounding.js";
import {
  linesIn,
  mainFileOf,
  partAt,
  type SpecFile,
} from "../../domain/feature-planning/issue-coverage.js";

/** A statement that names what the repository does not hold, with the names. */
export interface DriftStatement {
  file: string;
  line: number;
  names: string[];
}

export interface GroundedStatements {
  decomposition: DecompositionResult;
  drift: DriftStatement[];
}

/** The decomposition with every task dropped whose cited statements all name code that is not on `tree`, and those statements. */
export function withoutUngroundedStatements(
  decomposition: DecompositionResult,
  specs: readonly SpecFile[],
  tree: readonly string[],
): GroundedStatements {
  const drift = specs.flatMap((spec) => driftIn(spec, tree));
  const onlyDrift = citesOnlyDrift(specs, drift);
  const kept = decomposition.stories.map((story) => ({
    ...story,
    tasks: story.tasks.filter((task) => !onlyDrift(task)),
  }));
  const stories = kept.filter((story) => story.tasks.length > 0);

  return { decomposition: { ...decomposition, stories }, drift };
}

/** Whether a task cites statements and every one of them is drift. */
function citesOnlyDrift(
  specs: readonly SpecFile[],
  drift: readonly DriftStatement[],
): (task: DecompTask) => boolean {
  const driftKeys = new Set(drift.map(({ file, line }) => `${file}:${line}`));
  const mainFile = mainFileOf(specs);

  return (task) => {
    const cited = specs.flatMap((spec) =>
      linesIn(task.spec_lines ?? [], spec.file, mainFile).map(
        (line) => `${spec.file}:${partAt(spec.parts, line)?.line ?? line}`,
      ),
    );

    return cited.length > 0 && cited.every((key) => driftKeys.has(key));
  };
}

/** The parts of `spec` naming a path missing from `tree` or a retired part of Lore. */
export function driftIn(
  spec: SpecFile,
  tree: readonly string[],
): DriftStatement[] {
  return spec.parts.flatMap((part) => {
    const names = ungroundedNames(part.text, tree);

    return names.length > 0
      ? [{ file: spec.file, line: part.line, names }]
      : [];
  });
}

function ungroundedNames(text: string, tree: readonly string[]): string[] {
  const findings = groundingFindings({ text, tree, files: {} }).filter(
    (finding) => finding.kind === "path" || finding.kind === "retired",
  );

  return [...new Set(findings.map((finding) => finding.name))];
}

/** `specs` without the drift statements, so coverage asks no task to carry them. */
export function withoutDrift(
  specs: readonly SpecFile[],
  drift: readonly DriftStatement[],
): SpecFile[] {
  return specs.map((spec) => ({
    ...spec,
    parts: spec.parts.filter(
      (part) =>
        !drift.some(
          (entry) => entry.file === spec.file && entry.line === part.line,
        ),
    ),
  }));
}

/** One log line per drift statement, naming what the repository does not hold. */
export function driftLines(drift: readonly DriftStatement[]): string[] {
  return drift.map(
    ({ file, line, names }) =>
      `spec-tickets drift: ${file}:${line} names ${names.join(", ")}, which this repository does not hold; no ticket filed`,
  );
}

/** A run's specs and decomposition, both without the drift statements, which are logged. */
export function withoutDriftIn<S extends { specs: SpecFile[] }>(
  spec: S,
  decomposition: DecompositionResult,
  tree: readonly string[],
  log: (line: string) => void,
): { spec: S; decomposition: DecompositionResult } {
  const grounded = withoutUngroundedStatements(decomposition, spec.specs, tree);

  driftLines(grounded.drift).forEach(log);

  return {
    spec: { ...spec, specs: withoutDrift(spec.specs, grounded.drift) },
    decomposition: grounded.decomposition,
  };
}
