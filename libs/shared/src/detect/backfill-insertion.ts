// Pure link-insertion for spec-coverage-backfill: which statements need a link, and how a confirmed suggestion gets stitched into spec.md as a `(validated by ...)` parenthetical + unified diff.
import {
  parseTestLinksInStatement,
  type Statement,
  type Classification,
} from "../index.js";

// Statements classified `testable` with no inline test link yet — excludes narrative sections and already-linked statements so the cron never overwrites author-curated links.
export function pickStatementsForBackfill(
  statements: Statement[],
  classifications: Map<number, Classification>,
): Array<{ ordinal: number; text: string }> {
  const out: Array<{ ordinal: number; text: string }> = [];

  for (const s of statements) {
    const c = classifications.get(s.ordinal);

    if (!c || c.testability !== "testable") {
      continue;
    }

    if (parseTestLinksInStatement(s.text).length > 0) {
      continue;
    }
    out.push({ ordinal: s.ordinal, text: s.text });
  }

  return out;
}

// A pure computed value (judge verdict + unlinked text), not a table row; snake_case matches the spec-link markdown it renders.
// eslint-disable-next-line lore/no-row-types-outside-models
export interface Suggestion {
  statement_ordinal: number;
  /** Exact statement text expected verbatim in the content; skipped if not found. */
  statement_text: string;
  test_file: string;
  test_line: number | null;
  /** Markdown label for the inserted `[label](href)` token, e.g. "validated by `runner.test.ts:88`". */
  label: string;
}

export interface SkipReason {
  statement_ordinal: number;
  reason: "already-linked" | "not-found";
}

export interface InsertionResult {
  newContent: string;
  diffPreview: string;
  applied: number;
  skipped: SkipReason[];
}

function renderLink(s: Suggestion): string {
  const anchor = s.test_line ? `#L${s.test_line}` : "";

  return `[${s.label}](${s.test_file}${anchor})`;
}

function groupByOrdinal(suggestions: Suggestion[]): Map<number, Suggestion[]> {
  const byOrdinal = new Map<number, Suggestion[]>();

  for (const s of suggestions) {
    const list = byOrdinal.get(s.statement_ordinal) ?? [];

    list.push(s);
    byOrdinal.set(s.statement_ordinal, list);
  }

  return byOrdinal;
}

interface OrderedInsertion {
  ord: number;
  list: Suggestion[];
  text: string;
}

// Process ordinals deepest (latest) first so prior insertions don't shift later match indices.
function orderInsertions(
  byOrdinal: Map<number, Suggestion[]>,
  content: string,
): OrderedInsertion[] {
  return [...byOrdinal.entries()]
    .map(([ord, list]) => ({
      ord,
      list,
      text: list[0].statement_text,
      idx: content.indexOf(list[0].statement_text),
    }))
    .sort((a, b) => b.idx - a.idx);
}

type InsertionOutcome =
  | { kind: "skip"; reason: SkipReason }
  | { kind: "insert"; newContent: string; applied: number };

function insertOne(entry: OrderedInsertion, content: string): InsertionOutcome {
  const { ord, list, text } = entry;

  if (text.length === 0) {
    return {
      kind: "skip",
      reason: { statement_ordinal: ord, reason: "not-found" },
    };
  }

  const idx = content.indexOf(text);

  if (idx < 0) {
    return {
      kind: "skip",
      reason: { statement_ordinal: ord, reason: "not-found" },
    };
  }

  if (parseTestLinksInStatement(text).length > 0) {
    return {
      kind: "skip",
      reason: { statement_ordinal: ord, reason: "already-linked" },
    };
  }

  const tail = ` (${list.map(renderLink).join(", ")})`;
  const insertionPoint = idx + text.length;

  return {
    kind: "insert",
    newContent:
      content.slice(0, insertionPoint) + tail + content.slice(insertionPoint),
    applied: list.length,
  };
}

function diffLine(before: string, after: string): string[] {
  if (before === after) {
    return [];
  }

  const lines: string[] = [];

  if (before) {
    lines.push(`-${before}`);
  }

  if (after) {
    lines.push(`+${after}`);
  }

  return lines;
}

/** Tiny unified-diff renderer for the PR body. */
function buildUnifiedDiff(before: string, after: string): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const out: string[] = ["--- a/spec.md", "+++ b/spec.md"];
  const maxLen = Math.max(beforeLines.length, afterLines.length);

  for (let i = 0; i < maxLen; i++) {
    out.push(...diffLine(beforeLines[i] || "", afterLines[i] || ""));
  }

  return out.join("\n");
}

// For each statement_ordinal, locates the matching text and appends a `(...)` parenthetical of `[label](path#Lline)` links (comma-separated when multiple); skips already-linked or not-found statements.
export function proposeLinkInsertions(
  content: string,
  suggestions: Suggestion[],
): InsertionResult {
  if (suggestions.length === 0) {
    return { newContent: content, diffPreview: "", applied: 0, skipped: [] };
  }

  const ordered = orderInsertions(groupByOrdinal(suggestions), content);
  const skipped: SkipReason[] = [];
  let applied = 0;
  let newContent = content;

  for (const entry of ordered) {
    const outcome = insertOne(entry, newContent);

    if (outcome.kind === "skip") {
      skipped.push(outcome.reason);
      continue;
    }
    newContent = outcome.newContent;
    applied += outcome.applied;
  }

  const diffPreview = applied > 0 ? buildUnifiedDiff(content, newContent) : "";

  return { newContent, diffPreview, applied, skipped };
}
