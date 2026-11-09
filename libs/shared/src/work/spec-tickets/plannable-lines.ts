import type {
  DecompositionResult,
  DecompTask,
  SpecLine,
} from "../../domain/feature-planning/decomposition-result.js";
import { specParts } from "../../domain/feature-planning/issue-coverage.js";
import { segmentStatements } from "../../domain/spec-segment.js";

type Plannable = (entry: SpecLine) => boolean;

/** The decomposition without the spec lines that segment as statements but are not testable: they state no work (specs/spec-tickets FR24). */
export function withoutUnplannableLines(
  decomposition: DecompositionResult,
  spec: string,
  specPath: string,
): DecompositionResult {
  const plannable = plannableIn(spec, specPath);

  return {
    ...decomposition,
    stories: decomposition.stories.map((story) => ({
      ...story,
      tasks: story.tasks.map((task) => withPlannableLines(task, plannable)),
    })),
  };
}

function plannableIn(spec: string, specPath: string): Plannable {
  const unplannable = unplannableLines(spec);

  return (entry) =>
    (entry.file ?? specPath) !== specPath || !unplannable.has(entry.line);
}

function unplannableLines(spec: string): Set<number> {
  const testable = new Set(specParts(spec).map(({ line }) => line));
  const lines = segmentStatements(spec).map(({ line }) => line);

  return new Set(
    lines.filter(
      (line): line is number => line !== undefined && !testable.has(line),
    ),
  );
}

function withPlannableLines(
  task: DecompTask,
  plannable: Plannable,
): DecompTask {
  return {
    ...task,
    spec_lines: task.spec_lines?.filter(plannable),
    in_place: task.in_place?.filter(plannable),
  };
}
