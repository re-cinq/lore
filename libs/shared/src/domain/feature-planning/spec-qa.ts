// The blind question-and-answer check on a written spec: questions made from the plan alone, answers read from the spec alone, and the gate that sends the spec writer back with whatever failed (see specs/7-feature-planning/spec.md).

import { z } from "zod";

export const SPEC_QA_ROUNDS = 5;

const questionSchema = z.object({
  id: z.string(),
  section: z.string(),
  kind: z.enum(["plan", "technical"]),
  question: z.string(),
  answer: z.boolean().optional(),
  reason: z.string().optional(),
});

const noteSchema = z.object({
  id: z.string(),
  kind: z.enum(["comment", "answer", "question"]),
  text: z.string(),
  satisfied: z.boolean(),
  reason: z.string(),
});

export const specQaBagSchema = z.object({
  questions: z.array(questionSchema),
  notes: z.array(noteSchema),
});

export type SpecQaBag = z.infer<typeof specQaBagSchema>;

export interface QaFailure {
  id: string;
  text: string;
  reason: string;
}

export interface QaVerdict {
  outcome: "success" | "changes_requested";
  failures: QaFailure[];
  exhausted: boolean;
}

export function qaGate(bag: SpecQaBag, roundsSpent: number): QaVerdict {
  const failures = [
    ...bag.questions
      .filter((question) => question.answer !== true)
      .map((question) => ({
        id: question.id,
        text: question.question,
        reason: question.reason ?? "Not answered.",
      })),
    ...bag.notes
      .filter((note) => !note.satisfied)
      .map((note) => ({ id: note.id, text: note.text, reason: note.reason })),
  ];
  const exhausted = failures.length > 0 && roundsSpent >= SPEC_QA_ROUNDS;

  return {
    outcome:
      failures.length === 0 || exhausted ? "success" : "changes_requested",
    failures,
    exhausted,
  };
}

export function failureBrief(failures: QaFailure[]): string {
  if (failures.length === 0) {
    return "";
  }

  const lines = failures.map(
    (failure) => `- ${failure.id}: ${failure.text} (${failure.reason})\n`,
  );

  return `These checks failed against the spec. Fix the spec so each one holds:\n${lines.join("")}`;
}
