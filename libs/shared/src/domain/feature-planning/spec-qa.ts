// The blind question-and-answer check on a written spec: questions made once from the plan alone, each with the answer the plan implies, answers read from the spec alone, and the gate that sends the spec writer back with whatever failed (see specs/7-feature-planning/spec.md FR-17).

import { z } from "zod";

export const SPEC_QA_ROUNDS = 5;

export const specQuestionSchema = z.object({
  id: z.string(),
  section: z.string(),
  kind: z.enum(["plan", "technical", "note"]),
  severity: z.enum(["blocking", "advisory"]),
  /** The plan block this question was made from. */
  source: z.string(),
  question: z.string(),
  /** What a spec that keeps the plan answers: true for "the spec says X", false for a "must not". */
  expected: z.boolean(),
});

export const specAnswerSchema = z.object({
  id: z.string(),
  answer: z.boolean(),
  reason: z.string(),
});

export const specQaBagSchema = z.object({
  questions: z.array(specQuestionSchema),
  answers: z.array(specAnswerSchema),
});

export type SpecQuestion = z.infer<typeof specQuestionSchema>;
export type SpecQaBag = z.infer<typeof specQaBagSchema>;

export interface QaFailure {
  id: string;
  section: string;
  text: string;
  reason: string;
}

export interface QaVerdict {
  outcome: "success" | "changes_requested";
  failures: QaFailure[];
  exhausted: boolean;
}

export function qaGate(
  bag: SpecQaBag,
  roundsSpent: number,
  branchGaps = 0,
): QaVerdict {
  const failures = questionFailures(bag);
  const gaps = failures.length + branchGaps;
  const exhausted = gaps > 0 && roundsSpent >= SPEC_QA_ROUNDS;

  return {
    outcome: gaps === 0 || exhausted ? "success" : "changes_requested",
    failures,
    exhausted,
  };
}

function questionFailures({ questions, answers }: SpecQaBag): QaFailure[] {
  const answered = new Map(answers.map((answer) => [answer.id, answer]));

  return questions.flatMap((question) => {
    const given = answered.get(question.id);

    return given?.answer === question.expected
      ? []
      : [
          {
            id: question.id,
            section: question.section,
            text: question.question,
            reason: given?.reason ?? "Not answered.",
          },
        ];
  });
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
