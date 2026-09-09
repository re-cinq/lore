// LLM judge (statement-level) for spec-coverage-backfill, inlined from the v2 linker: decides whether one test validates one enumerated spec statement.
import { type JudgeCandidate, type Judgment } from "../../domain/spec-judge.js";
import { Llm } from "../../outbound/llm/llm.js";

type JudgeVerdict = Omit<
  Judgment,
  "test_file" | "test_name" | "test_line" | "symbol" | "match_kind"
>;

interface JudgeSuggestion {
  matches: boolean;
  statement_ordinal?: number;
  score?: number;
  rationale: string;
}

export async function judgeLink(
  spec: { file_path: string; content: string },
  testable: { ordinal: number; text: string }[],
  candidate: JudgeCandidate,
): Promise<JudgeVerdict> {
  if (testable.length === 0) {
    return noMatchVerdict("No testable statements; nothing to validate.");
  }

  return resolveJudgeVerdict(
    testable,
    await askJudge(spec, testable, candidate),
  );
}

function resolveJudgeVerdict(
  testable: { ordinal: number; text: string }[],
  suggestion: JudgeSuggestion,
): JudgeVerdict {
  const rationale = cleanRationale(suggestion.rationale || "");

  if (suggestion.matches !== true) {
    return noMatchVerdict(rationale);
  }

  const ordinal = pickedOrdinal(suggestion);
  const match = testable.find((s) => s.ordinal === ordinal);

  return match
    ? matchVerdict(match, suggestion, rationale)
    : noMatchVerdict(
        `Judge picked ordinal ${ordinal} not in the enumerated set; dropped.`,
      );
}

const JUDGE_TOOL_SCHEMA = {
  type: "object",
  properties: {
    matches: {
      type: "boolean",
      description:
        "True only if this test actually validates a SPECIFIC enumerated statement.",
    },
    statement_ordinal: {
      type: "integer",
      description:
        "The ordinal of the SINGLE statement most strongly validated, from the enumerated TESTABLE STATEMENTS list. Required when matches=true.",
    },
    score: {
      type: "number",
      description:
        "Confidence 0.0–1.0 that this test validates the chosen statement.",
    },
    rationale: {
      type: "string",
      description: "One sentence referencing the behavior validated.",
    },
  },
  required: ["matches", "rationale"],
};

/** Asks the model through a TOOL so the answer arrives as fields rather than prose to interpret. */
async function askJudge(
  spec: { file_path: string; content: string },
  testable: { ordinal: number; text: string }[],
  candidate: JudgeCandidate,
): Promise<JudgeSuggestion> {
  const result = await Llm.instance.completeWithTool<JudgeSuggestion>({
    prompt: judgePrompt(spec, testable, candidate),
    systemPrompt:
      "You judge whether a test validates one specific enumerated statement of a specification. Be strict: shared vocabulary is not validation. Pick a single best-match statement when matches=true and give a one-sentence rationale.",
    toolName: "judge_link",
    toolDescription:
      "Decide whether a test validates one enumerated spec statement",
    toolSchema: JUDGE_TOOL_SCHEMA,
    jobName: "spec_coverage_backfill",
  });

  return result.parsed;
}

function noMatchVerdict(rationale: string): JudgeVerdict {
  return {
    matches: false,
    statement_ordinal: null,
    statement_text: null,
    match_score: 0,
    rationale,
  };
}

function cleanRationale(raw: string): string {
  const rationale = raw.trim();

  return rationale.length > 0
    ? rationale
    : "Judged relevant; no rationale returned.";
}

/** The ordinal the model claims to have matched, or null when it answered with anything but a number. */
function pickedOrdinal(suggestion: JudgeSuggestion): number | null {
  return typeof suggestion.statement_ordinal === "number"
    ? suggestion.statement_ordinal
    : null;
}

const JUDGE_SCORE_THRESHOLD = 0.5;

/** A confirmed match; an absent or out-of-range score falls back to the threshold rather than to zero, because the model already answered matches=true. */
function matchVerdict(
  match: { ordinal: number; text: string },
  suggestion: JudgeSuggestion,
  rationale: string,
): JudgeVerdict {
  return {
    matches: true,
    statement_ordinal: match.ordinal,
    statement_text: match.text,
    match_score: isValidScore(suggestion.score)
      ? suggestion.score
      : JUDGE_SCORE_THRESHOLD,
    rationale,
  };
}

function isValidScore(score: unknown): score is number {
  return typeof score === "number" && score >= 0 && score <= 1;
}

/** The judge prompt: the spec's testable statements enumerated by ordinal, and the candidate test's source. */
function judgePrompt(
  spec: { file_path: string; content: string },
  testable: { ordinal: number; text: string }[],
  candidate: JudgeCandidate,
): string {
  return `Decide whether the TEST validates a SPECIFIC enumerated TESTABLE STATEMENT below. Answer true only when the test exercises a behaviour described by ONE statement — not merely shared vocabulary.

If true, pick the SINGLE statement most strongly validated (its ordinal) and a confidence \`score\` 0.0–1.0. If false, omit ordinal/score.

SPEC: ${spec.file_path}

TESTABLE STATEMENTS:
${formatTestableStatements(testable)}

TEST (${candidate.test_file} › ${candidate.test_name}):
---
${candidate.content.substring(0, 4000)}
---`;
}

function formatTestableStatements(
  statements: { ordinal: number; text: string }[],
): string {
  return statements.map((s) => `[${s.ordinal}] ${s.text}`).join("\n");
}
