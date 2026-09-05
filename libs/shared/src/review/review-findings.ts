// Structured output contract for the code-review `review` node: the agent emits a fenced ```REVIEW_FINDINGS JSON block matching {@link ReviewOutput}; a malformed/absent block yields `null` rather than crashing the node.
import type {
  ConventionalDecoration,
  ConventionalLabel,
} from "./conventional-comment.js";
import { isRecord } from "../lib/is-record.js";

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
  const raw = normalizeAliases(safeParseJson(match[1].trim()));

  return isReviewOutput(raw) ? raw : null;
}

// Accepts the OTHER findings schema (`/code-review` skill's file/category/short_summary/failure_scenario) this repo also defines, since models reliably emit it here and its well-formed JSON was otherwise silently rejected by the shape check (#1698/#1699/#1703, same root cause as #1401).
function normalizeAliases(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.findings)) {
    return value;
  }

  return {
    ...value,
    findings: value.findings.map((finding) =>
      isRecord(finding) ? normalizeFinding(finding) : finding,
    ),
  };
}

// A present label is left as-written even if invalid (rejecting a typo is deliberate); only a missing label is defaulted, from `category` when valid, else `issue`.
function findingLabel(finding: Record<string, unknown>): unknown {
  if (finding.label !== undefined) {
    return finding.label;
  }

  return includes(LABELS, finding.category) ? finding.category : "issue";
}

function normalizeFinding(finding: Record<string, unknown>): unknown {
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.length > 0 ? v : undefined;
  const label = findingLabel(finding);
  const joined = [str(finding.summary), str(finding.failure_scenario)]
    .filter((part): part is string => part !== undefined)
    .join("\n\n");
  const discussion = str(finding.discussion) ?? str(joined);

  return {
    ...finding,
    path: str(finding.path) ?? str(finding.file),
    subject:
      str(finding.subject) ??
      str(finding.short_summary) ??
      str(finding.summary),
    label,
    ...(discussion === undefined ? {} : { discussion }),
  };
}

// Tolerates the one class of malformed JSON a model reliably produces: an unescaped quote/newline in a narrative field, which killed JSON.parse and discarded every finding in #1401. Strict parse tried first; repair only on SyntaxError.
function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // fall through to the repair pass below
  }

  try {
    return JSON.parse(repairUnescapedStringContent(text));
  } catch {
    return null;
  }
}

// Escapes literal newlines/quotes INSIDE a JSON string, leaving true closing quotes untouched; can't be a single regex since whether `"` closes the string depends on what follows it.
const WHITESPACE_ESCAPES: Record<string, string | undefined> = {
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
};

interface RepairState {
  result: string;
  inString: boolean;
}

function appendNonStringChar(state: RepairState, ch: string): void {
  state.inString = ch === '"';
  state.result += ch;
}

// An escape sequence: copy it and its target verbatim, untouched.
function appendEscapeSequence(
  state: RepairState,
  text: string,
  i: number,
): number {
  state.result += text[i] + (text[i + 1] ?? "");

  return i + 1;
}

function appendQuoteChar(state: RepairState, text: string, i: number): number {
  if (closesAString(text, i + 1)) {
    state.inString = false;
    state.result += '"';

    return i;
  }
  state.result += '\\"';

  return i;
}

function appendInStringChar(
  state: RepairState,
  text: string,
  i: number,
): number {
  const ch = text[i];

  if (ch === "\\") {
    return appendEscapeSequence(state, text, i);
  }
  const escaped = WHITESPACE_ESCAPES[ch];

  if (escaped !== undefined) {
    state.result += escaped;

    return i;
  }

  return ch === '"'
    ? appendQuoteChar(state, text, i)
    : appendPlainChar(state, ch, i);
}

function appendPlainChar(state: RepairState, ch: string, i: number): number {
  state.result += ch;

  return i;
}

function repairUnescapedStringContent(text: string): string {
  const state: RepairState = { result: "", inString: false };

  for (let i = 0; i < text.length; i++) {
    if (!state.inString) {
      appendNonStringChar(state, text[i]);
      continue;
    }
    i = appendInStringChar(state, text, i);
  }

  return state.result;
}

// Whether the char at text[from] (skipping whitespace) can only follow a closing JSON string quote (`,}]:` or EOF); including `:` has a known false-positive on a quoted-then-colon narrative value, but that just falls back to `null`, never a silent corruption.
function closesAString(text: string, from: number): boolean {
  let j = from;

  while (j < text.length && /\s/.test(text[j])) {
    j++;
  }

  return j >= text.length || ",}]:".includes(text[j]);
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

function hasRequiredFindingFields(value: Record<string, unknown>): boolean {
  return (
    typeof value.path === "string" &&
    typeof value.line === "number" &&
    typeof value.subject === "string" &&
    includes(LABELS, value.label)
  );
}

function hasValidOptionalFindingFields(
  value: Record<string, unknown>,
): boolean {
  return (
    optional(value.side, (v) => includes(SIDES, v)) &&
    optional(value.decoration, (v) => includes(DECORATIONS, v)) &&
    optional(value.discussion, (v) => typeof v === "string") &&
    optional(value.suggestion, (v) => typeof v === "string")
  );
}

function isReviewFinding(value: unknown): value is ReviewFinding {
  if (!isRecord(value)) {
    return false;
  }

  return (
    hasRequiredFindingFields(value) && hasValidOptionalFindingFields(value)
  );
}

function includes<T extends string>(allowed: T[], value: unknown): value is T {
  return typeof value === "string" && (allowed as string[]).includes(value);
}

// `null` counts as absent (same as omitting the key) — treating it as a value that fails its type check discarded an entire ten-finding review as #1401, recurring six times on one PR (2026-08-25). A wrong type is still rejected.
function optional(value: unknown, check: (v: unknown) => boolean): boolean {
  return value === undefined || value === null || check(value);
}
