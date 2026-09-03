// Author's submitted feedback recovered for display (persisted on iteration row).

import type { SectionAnswers, SectionDirection } from "./feature-types";

export interface SubmittedLine {
  /** The section title, the question id, or the free-form heading. */
  heading: string;
  /** Only a section carries one. */
  direction: SectionDirection | null;
  body: string;
}

/** Author's input for a round (sections, questions, free-form); whitespace-only dropped. */
export function submittedFeedback(
  answers: SectionAnswers | null | undefined,
): SubmittedLine[] {
  if (!answers) {
    return [];
  }
  const lines: SubmittedLine[] = [];

  for (const [heading, section] of Object.entries(answers.sections ?? {})) {
    const body = section.comment?.trim() ?? "";

    if (body || section.direction) {
      lines.push({ heading, direction: section.direction ?? null, body });
    }
  }

  for (const [heading, answer] of Object.entries(answers.questions ?? {})) {
    if (answer.trim()) {
      lines.push({ heading, direction: null, body: answer.trim() });
    }
  }
  const note = answers.free_form?.trim();

  if (note) {
    lines.push({ heading: "Other comments", direction: null, body: note });
  }

  return lines;
}
