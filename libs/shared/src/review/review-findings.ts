/**
 * The structured output contract for the code-review `review` node. The agent
 * assesses the diff and emits a fenced ` ```REVIEW_FINDINGS ` JSON block matching
 * {@link ReviewOutput} — it does NOT post comments itself. The deterministic
 * poster parses that block and renders each finding as a {@link ConventionalComment}.
 *
 * Validation is a plain guard (shared carries no zod): a malformed or absent block
 * yields `null`, so a formatting slip posts no comments rather than crashing the node.
 */

import type {
  ConventionalDecoration,
  ConventionalLabel,
} from "./conventional-comment.js";

export type ReviewVerdict = "approved" | "changes_requested";
export type DiffSide = "LEFT" | "RIGHT";

export interface ReviewFinding {
  path: string;
  line: number;
  side?: DiffSide;
  label: ConventionalLabel;
  decoration?: ConventionalDecoration;
  subject: string;
  discussion?: string;
  suggestion?: string;
}

export interface ReviewOutput {
  verdict: ReviewVerdict;
  findings: ReviewFinding[];
  summary?: string;
}

const LABELS: ConventionalLabel[] = [
  "issue",
  "suggestion",
  "nit",
  "question",
  "praise",
  "thought",
  "chore",
];
const DECORATIONS: ConventionalDecoration[] = [
  "blocking",
  "non-blocking",
  "if-minor",
];
const VERDICTS: ReviewVerdict[] = ["approved", "changes_requested"];
const SIDES: DiffSide[] = ["LEFT", "RIGHT"];

const FINDINGS_BLOCK = /```REVIEW_FINDINGS\s*\n([\s\S]*?)```/;

export function parseReviewFindings(output: string): ReviewOutput | null {
  const match = output.match(FINDINGS_BLOCK);

  if (!match) {
    return null;
  }
  const raw = safeParseJson(match[1].trim());

  return isReviewOutput(raw) ? raw : null;
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isReviewOutput(value: unknown): value is ReviewOutput {
  if (!isRecord(value)) {
    return false;
  }
  if (!includes(VERDICTS, value.verdict)) {
    return false;
  }
  if (value.summary !== undefined && typeof value.summary !== "string") {
    return false;
  }

  return Array.isArray(value.findings) && value.findings.every(isReviewFinding);
}

function isReviewFinding(value: unknown): value is ReviewFinding {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.path === "string" &&
    typeof value.line === "number" &&
    typeof value.subject === "string" &&
    includes(LABELS, value.label) &&
    optional(value.side, (v) => includes(SIDES, v)) &&
    optional(value.decoration, (v) => includes(DECORATIONS, v)) &&
    optional(value.discussion, (v) => typeof v === "string") &&
    optional(value.suggestion, (v) => typeof v === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function includes<T extends string>(allowed: T[], value: unknown): value is T {
  return typeof value === "string" && (allowed as string[]).includes(value);
}

function optional(value: unknown, check: (v: unknown) => boolean): boolean {
  return value === undefined || check(value);
}
