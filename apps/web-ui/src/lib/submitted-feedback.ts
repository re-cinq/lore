// Author's submitted feedback recovered for display (persisted on iteration row).

import type { SectionAnswers, SectionDirection } from "./feature-types";

export interface SubmittedLine {
  /** The section title, the question id, or the free-form heading. */
  heading: string;
  /** Only a section carries one. */
  direction: SectionDirection | null;
  body: string;
}

function sectionLines(sections: SectionAnswers["sections"]): SubmittedLine[] {
  return Object.entries(sections ?? {})
    .map(([heading, section]) => ({
      heading,
      direction: section.direction ?? null,
      body: section.comment?.trim() ?? "",
    }))
    .filter((line) => line.body || line.direction);
}

function questionLines(
  questions: SectionAnswers["questions"],
): SubmittedLine[] {
  return Object.entries(questions ?? {})
    .map(([heading, answer]) => ({
      heading,
      direction: null,
      body: answer.trim(),
    }))
    .filter((line) => line.body);
}

function freeFormLine(freeForm: string | undefined): SubmittedLine[] {
  const note = freeForm?.trim();

  return note
    ? [{ heading: "Other comments", direction: null, body: note }]
    : [];
}

/** Author's input for a round (sections, questions, free-form); whitespace-only dropped. */
export function submittedFeedback(
  answers: SectionAnswers | null | undefined,
): SubmittedLine[] {
  if (!answers) {
    return [];
  }

  return [
    ...sectionLines(answers.sections),
    ...questionLines(answers.questions),
    ...freeFormLine(answers.free_form),
  ];
}
