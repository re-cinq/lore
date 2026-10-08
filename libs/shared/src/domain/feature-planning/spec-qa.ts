// The blind question-and-answer check on a written spec: questions made once from the plan alone, each with the answer the plan implies, answers read from the spec alone, and the gate that sends the spec writer back with whatever failed (see specs/7-feature-planning/spec.md FR-24).

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
  /** A verbatim span of the spec that supports an answer upholding the question. */
  evidence: z.string().optional(),
});

export const specQaBagSchema = z.object({
  questions: z.array(specQuestionSchema),
  answers: z.array(specAnswerSchema),
});

export type SpecQuestion = z.infer<typeof specQuestionSchema>;
export type SpecAnswer = z.infer<typeof specAnswerSchema>;
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

/** `specTexts` are the spec files the answers were read from; with them, an answer that upholds a question must quote one. Null skips that check. */
export function qaGate(
  bag: SpecQaBag,
  roundsSpent: number,
  branchGaps = 0,
  specTexts: readonly string[] | null = null,
): QaVerdict {
  const failures = questionFailures(bag, specTexts);
  const gaps = failures.length + branchGaps;
  const exhausted = gaps > 0 && roundsSpent >= SPEC_QA_ROUNDS;

  return {
    outcome: gaps === 0 || exhausted ? "success" : "changes_requested",
    failures,
    exhausted,
  };
}

function questionFailures(
  { questions, answers }: SpecQaBag,
  specTexts: readonly string[] | null,
): QaFailure[] {
  const answered = new Map(answers.map((answer) => [answer.id, answer]));

  return questions.flatMap((question) =>
    failureOf(question, answered.get(question.id), specTexts),
  );
}

function failureOf(
  question: SpecQuestion,
  given: SpecAnswer | undefined,
  specTexts: readonly string[] | null,
): QaFailure[] {
  const reason = failureReason(question, given, specTexts);
  const { id, section, question: text } = question;

  return reason === null ? [] : [{ id, section, text, reason }];
}

const NO_QUOTE = "No quote from the spec supports this answer.";

function failureReason(
  question: SpecQuestion,
  given: SpecAnswer | undefined,
  specTexts: readonly string[] | null,
): string | null {
  if (given?.answer !== question.expected) {
    return given?.reason ?? "Not answered.";
  }

  return unquoted(question, given, specTexts) ? NO_QUOTE : null;
}

function unquoted(
  question: SpecQuestion,
  given: SpecAnswer,
  specTexts: readonly string[] | null,
): boolean {
  return (
    specTexts !== null &&
    question.expected &&
    !evidenceHolds(given.evidence, specTexts)
  );
}

/** Whether the quote an answer gives is in a spec, ignoring only how the whitespace falls. */
export function evidenceHolds(
  evidence: string | undefined,
  specTexts: readonly string[],
): boolean {
  const quote = squash(evidence ?? "");

  return quote !== "" && specTexts.some((text) => squash(text).includes(quote));
}

function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
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
