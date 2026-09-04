// LLM judge (statement-level) for spec-coverage-backfill, inlined from the v2 linker: decides whether one test validates one enumerated spec statement.
import { Llm, type JudgeCandidate, type Judgment } from "../index.js";

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

function formatTestableStatements(
  statements: { ordinal: number; text: string }[],
): string {
  return statements.map((s) => `[${s.ordinal}] ${s.text}`).join("\n");
}

const JUDGE_SCORE_THRESHOLD = 0.5;

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

function isValidScore(score: unknown): score is number {
  return typeof score === "number" && score >= 0 && score <= 1;
}

function resolveJudgeVerdict(
  testable: { ordinal: number; text: string }[],
  suggestion: JudgeSuggestion,
): JudgeVerdict {
  const rationale = cleanRationale(suggestion.rationale || "");

  if (suggestion.matches !== true) {
    return noMatchVerdict(rationale);
  }

  const ordinal =
    typeof suggestion.statement_ordinal === "number"
      ? suggestion.statement_ordinal
      : null;
  const match = testable.find((s) => s.ordinal === ordinal);

  if (!match) {
    return noMatchVerdict(
      `Judge picked ordinal ${ordinal} not in the enumerated set; dropped.`,
    );
  }

  const score = isValidScore(suggestion.score)
    ? suggestion.score
    : JUDGE_SCORE_THRESHOLD;

  return {
    matches: true,
    statement_ordinal: match.ordinal,
    statement_text: match.text,
    match_score: score,
    rationale,
  };
}

export async function judgeLink(
  spec: { file_path: string; content: string },
  testable: { ordinal: number; text: string }[],
  candidate: JudgeCandidate,
): Promise<JudgeVerdict> {
  if (testable.length === 0) {
    return noMatchVerdict("No testable statements; nothing to validate.");
  }
  const result = await Llm.instance.completeWithTool<JudgeSuggestion>({
    prompt: `Decide whether the TEST validates a SPECIFIC enumerated TESTABLE STATEMENT below. Answer true only when the test exercises a behaviour described by ONE statement — not merely shared vocabulary.

If true, pick the SINGLE statement most strongly validated (its ordinal) and a confidence \`score\` 0.0–1.0. If false, omit ordinal/score.

SPEC: ${spec.file_path}

TESTABLE STATEMENTS:
${formatTestableStatements(testable)}

TEST (${candidate.test_file} › ${candidate.test_name}):
---
${candidate.content.substring(0, 4000)}
---`,
    systemPrompt:
      "You judge whether a test validates one specific enumerated statement of a specification. Be strict: shared vocabulary is not validation. Pick a single best-match statement when matches=true and give a one-sentence rationale.",
    toolName: "judge_link",
    toolDescription:
      "Decide whether a test validates one enumerated spec statement",
    toolSchema: JUDGE_TOOL_SCHEMA,
    jobName: "spec_coverage_backfill",
  });

  return resolveJudgeVerdict(testable, result.parsed);
}
