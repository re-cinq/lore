// What the author submitted for a round, recovered for display.
//
// The feedback is persisted on the iteration row before the pod is ever dispatched,
// so a failing pipeline cannot lose it — but nothing read it back, and the wizard
// clears the form on submit. The words left the screen the moment the button was
// pressed, and a failed round had no way back to them.

import type { SectionAnswers, SectionDirection } from "./feature-types";

export interface SubmittedLine {
  /** The section title, the question id, or the free-form heading. */
  heading: string;
  /** Only a section carries one. */
  direction: SectionDirection | null;
  body: string;
}

/**
 * The author's input for a round, in the order they gave it: per-section comments
 * and directions, then answered questions, then the free-form note.
 *
 * A section marked `keep` with no comment is still input — the author said something
 * about that section — so it survives with an empty body. Whitespace-only text is
 * not input and is dropped. Round one, which reacts to nothing, yields nothing.
 */
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
