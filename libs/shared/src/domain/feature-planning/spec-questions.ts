// Checks a generated question set against the plan it came from before any round uses it, because the set is frozen: a question that cites nothing, or an open plan question nobody asked about, would be chased by every fix round (see specs/7-feature-planning/spec.md FR-17).

import type { CitablePlan } from "./plan-coverage.js";
import type { SpecQuestion } from "./spec-qa.js";

// A block kind the plan's people left to be settled: the spec must keep it open or answer it.
const NOTE_BLOCK_KINDS: Record<string, string> = {
  question: "an open question",
  comment: "a comment",
};

/** `plan` is null where the deployment names no web UI, so there are no blocks to cite. */
export function questionErrors(
  questions: readonly SpecQuestion[],
  plan: CitablePlan | null,
): string[] {
  return [
    ...duplicateIds(questions),
    ...(plan ? planErrors(questions, plan) : []),
    ...(questions.length === 0 ? ["The set has no question."] : []),
  ];
}

function planErrors(
  questions: readonly SpecQuestion[],
  plan: CitablePlan,
): string[] {
  const blockIds = new Set(plan.blocks.map((block) => block.id));

  return [
    ...questions
      .filter((question) => !blockIds.has(question.source))
      .map(
        (question) =>
          `${question.id} cites plan block ${question.source}, which the plan does not have.`,
      ),
    ...uncoveredNotes(questions, plan),
  ];
}

function duplicateIds(questions: readonly SpecQuestion[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();

  for (const { id } of questions) {
    (seen.has(id) ? repeated : seen).add(id);
  }

  return [...repeated].map((id) => `${id} is used for more than one question.`);
}

function uncoveredNotes(
  questions: readonly SpecQuestion[],
  plan: CitablePlan,
): string[] {
  const noted = new Set(
    questions
      .filter((question) => question.kind === "note")
      .map((question) => question.source),
  );

  return uncovered(plan.blocks, noted).map(
    (block) =>
      `Plan block ${block.id} (${NOTE_BLOCK_KINDS[block.kind]}) has no question of kind note.`,
  );
}

function uncovered(blocks: CitablePlan["blocks"], noted: Set<string>) {
  return blocks.filter(
    (block) => block.kind in NOTE_BLOCK_KINDS && !noted.has(block.id),
  );
}

export function questionErrorsBrief(errors: readonly string[]): string {
  if (errors.length === 0) {
    return "";
  }

  return `The question set you wrote has these problems. Write the whole set again with each fixed:\n${errors.map((error) => `- ${error}\n`).join("")}`;
}
