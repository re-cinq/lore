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
  const raw = safeParseJson(match[1].trim());

  return isReviewOutput(raw) ? raw : null;
}

/**
 * Parse a REVIEW_FINDINGS block, tolerating the one class of malformed JSON a
 * model reliably produces: a free-written narrative field (`discussion`,
 * `subject`, `suggestion`) that quotes a symbol, or wraps a line, without
 * escaping it. #1401 reproduced this verbatim — a well-formed block whose one
 * broken string killed `JSON.parse` and discarded every finding, including the
 * blocking one. Strict parsing is tried first; only a `SyntaxError` falls
 * through to the repair pass, so already-valid JSON never takes this path.
 */
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

/**
 * Escape literal newlines and quotes found INSIDE a JSON string value, leaving
 * everything outside strings — and every quote that actually closes one —
 * untouched.
 *
 * A quote is read as a closer only when the next non-whitespace character is
 * one JSON allows there: `,` `}` `]` `:` or end of input. Anything else — the
 * common case being a quoted word inside a sentence — is a literal quote the
 * model forgot to escape, so it is escaped here instead. This cannot be done
 * with a single regex: whether a `"` closes the string depends on what comes
 * after it, which a regex has no way to look past reliably once the string
 * itself may contain further quotes.
 */
function repairUnescapedStringContent(text: string): string {
  let result = "";
  let inString = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (!inString) {
      if (ch === '"') {
        inString = true;
      }
      result += ch;
      continue;
    }

    if (ch === "\\") {
      // An escape sequence: copy it and its target verbatim, untouched.
      result += ch + (text[i + 1] ?? "");
      i++;
      continue;
    }

    if (ch === "\n" || ch === "\r" || ch === "\t") {
      result += ch === "\n" ? "\\n" : ch === "\r" ? "\\r" : "\\t";
      continue;
    }

    if (ch === '"') {
      if (closesAString(text, i + 1)) {
        inString = false;
        result += ch;
      } else {
        result += '\\"';
      }
      continue;
    }

    result += ch;
  }

  return result;
}

/**
 * Whether the character at `text[from]`, skipping whitespace, is one that can
 * only follow the end of a JSON string — i.e. the quote just before it closed
 * the string rather than sitting inside it.
 *
 * Including `:` is what lets a key's closing quote (`"key":`) be told apart
 * from a literal one — but it also means a narrative value that itself
 * quotes-then-colons a word, e.g. `"discussion":"the \"foo\": bar case"`, is
 * read as closing early at that inner quote. That does not produce a wrong
 * repair: the string JSON.parse then sees is malformed either way, so this
 * input still comes back `null`, same as no repair at all — just a known
 * limit of the heuristic, not a silent corruption.
 */
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

function includes<T extends string>(allowed: T[], value: unknown): value is T {
  return typeof value === "string" && (allowed as string[]).includes(value);
}

/**
 * An optional field: absent, explicitly null, or of the right type.
 *
 * `null` counts as absent because that is what it means here. A model writing
 * `"suggestion": null` for a finding that has no suggestion is saying the same
 * thing as omitting the key, and the two spellings must not decide whether a
 * review reaches the author.
 *
 * Read as a VALUE, one null failed its type check, `every` failed with it, and
 * the ENTIRE block was discarded — so a review that found ten things posted none
 * and its node failed with the findings lost. That is the shape of #1401, and it
 * recurred six times on one PR on 2026-08-25 before anyone could read what the
 * review had actually said.
 *
 * A wrong TYPE is still rejected: this widens what counts as absent, not what
 * counts as valid.
 */
function optional(value: unknown, check: (v: unknown) => boolean): boolean {
  return value === undefined || value === null || check(value);
}
