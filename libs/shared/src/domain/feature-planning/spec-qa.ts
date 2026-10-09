// The blind question-and-answer check on a written spec: questions made once from the plan alone, each with the answer the plan implies, answers read from the spec alone, and the gate that sends the spec writer back with whatever failed (see specs/7-feature-planning/spec.md FR-24).

import { z } from "zod";
import { INTEGRATED_SLOTS, type RedoRequest } from "./spec-sections.js";

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
  /** `stalled`: the gate gave up, by rounds spent or by gaps that stopped falling; what is left goes back to the plan as findings. */
  outcome: "success" | "changes_requested" | "stalled";
  /** The blocking failures: what sends the writer back. */
  failures: QaFailure[];
  /** Failures of questions worth knowing about but not worth a round; listed in the pull request. */
  advisory: QaFailure[];
  exhausted: boolean;
  /** The gaps did not fall since the last round, so asking again would only repeat it. */
  stalled: boolean;
}

export interface GateOptions {
  roundsSpent: number;
  /** Gaps the spec's own checks found, which no question maps to. */
  branchGaps?: number;
  /** The spec files the answers were read from; with them, an answer that upholds a question must quote one. */
  specTexts?: readonly string[] | null;
  /** The gap count of the round before, when there was one. */
  previousGaps?: number | null;
}

export function qaGate(bag: SpecQaBag, options: GateOptions): QaVerdict {
  const { blocking, advisory } = questionFailures(
    bag,
    options.specTexts ?? null,
  );
  const gaps = blocking.length + (options.branchGaps ?? 0);
  const exhausted = gaps > 0 && options.roundsSpent >= SPEC_QA_ROUNDS;
  const stalled = stalledAt(gaps, options.previousGaps ?? null);

  return {
    outcome: outcomeOf({ gaps, exhausted, stalled }),
    failures: blocking,
    advisory,
    exhausted,
    stalled,
  };
}

function outcomeOf({
  gaps,
  exhausted,
  stalled,
}: Pick<QaVerdict, "exhausted" | "stalled"> & {
  gaps: number;
}): QaVerdict["outcome"] {
  if (gaps === 0) {
    return "success";
  }

  return exhausted || stalled ? "stalled" : "changes_requested";
}

function stalledAt(gaps: number, previousGaps: number | null): boolean {
  return gaps > 0 && previousGaps !== null && gaps >= previousGaps;
}

/** Puts a second pod's answers in place of the first's for the questions it was asked, so the gate judges a failure only as the two pods left it. */
export function withRecheck(
  bag: SpecQaBag,
  recheck: readonly SpecAnswer[],
): SpecQaBag {
  const second = new Map(recheck.map((answer) => [answer.id, answer]));

  return {
    ...bag,
    answers: bag.answers.map((answer) => second.get(answer.id) ?? answer),
  };
}

interface Found {
  failure: QaFailure;
  severity: SpecQuestion["severity"];
}

function questionFailures(
  { questions, answers }: SpecQaBag,
  specTexts: readonly string[] | null,
): { blocking: QaFailure[]; advisory: QaFailure[] } {
  const answered = new Map(answers.map((answer) => [answer.id, answer]));
  const found = questions.flatMap((question) =>
    failureOf(question, answered.get(question.id), specTexts),
  );

  return {
    blocking: failuresOf(found, "blocking"),
    advisory: failuresOf(found, "advisory"),
  };
}

function failuresOf(
  found: readonly Found[],
  severity: Found["severity"],
): QaFailure[] {
  return found
    .filter((entry) => entry.severity === severity)
    .map((entry) => entry.failure);
}

function failureOf(
  question: SpecQuestion,
  given: SpecAnswer | undefined,
  specTexts: readonly string[] | null,
): Found[] {
  const reason = failureReason(question, given, specTexts);
  const { id, section, question: text, severity } = question;

  return reason === null
    ? []
    : [{ failure: { id, section, text, reason }, severity }];
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
  return briefOf(
    "These checks failed against the spec. Fix the spec so each one holds:",
    failures,
  );
}

export function advisoryBrief(failures: QaFailure[]): string {
  return briefOf(
    "These checks failed against the spec but did not hold up the pull request:",
    failures,
  );
}

function briefOf(heading: string, failures: readonly QaFailure[]): string {
  if (failures.length === 0) {
    return "";
  }
  const lines = failures.map(
    (failure) =>
      `- ${failure.id} [${redoSection(failure.section)}]: ${failure.text} (${failure.reason})\n`,
  );

  return `${heading}\n${lines.join("")}`;
}

/** The sections the next fix pass redoes: each section a failure belongs to, and the repair visit for gaps no question maps to a section the line integrates. */
export function redoRequest(
  failures: readonly QaFailure[],
  branchGaps: number,
  round: number,
): RedoRequest {
  const sections = failures.map(({ section }) => redoSection(section));
  const unmapped = branchGaps > 0 ? ["*"] : [];

  return { round, sections: [...new Set([...sections, ...unmapped])] };
}

/** The section a fix pass handles a failure under: its own when the line integrates it, else the repair visit. */
function redoSection(section: string): string {
  return INTEGRATED_SLOTS.includes(section) ? section : "*";
}
