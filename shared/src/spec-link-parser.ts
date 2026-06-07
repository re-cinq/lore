/**
 * Pure parser for inline link parentheticals at the end of a
 * spec.md statement.
 *
 * v3 of `spec-test-coverage` puts the source of truth for the
 * spec → test link in markdown, inside the spec itself:
 *
 *     Returns the expected value.
 *     ([validated by `runner.test.ts:88`](mcp-server/src/runner.test.ts#L88))
 *
 * Two parsers share the same trailing-parenthetical scan and differ
 * only by which links they keep:
 *   - `parseTestLinksInStatement` keeps links whose path is a test
 *     file (`isTestFile()`) — these become VALIDATED_BY edges. The
 *     UI's rehype plugin uses it to mark which `<a>` is a test link;
 *     the validate cron resolves each tuple against AST chunks; the
 *     backfill cron's `proposeLinkInsertions` uses it to skip
 *     statements that already carry a test link.
 *   - `parseCodeLinksInStatement` keeps the complement — links to
 *     non-test source files — which become IMPLEMENTED_BY edges in
 *     the spec-traceability graph.
 *
 * Format (locked by `spec-test-coverage` v3 §Decisions):
 *   - The parenthetical is at the END of the statement (the last
 *     `(...)` group on the line, optionally followed by a closing
 *     period).
 *   - Inside the parenthetical: one or more `[label](path#Lline)`
 *     markdown links, comma-separated.
 *
 * Each parser returns an empty array when:
 *   - no trailing parenthetical, OR
 *   - the parenthetical contains no markdown links, OR
 *   - the parenthetical contains no links the parser keeps.
 */

import { isTestFile } from "./test-paths.js";

/** A resolved `[label](path#Lline)` link parsed from a statement's
 * trailing parenthetical. Shared shape for both test and code links. */
export interface SpecLinkRef {
  label: string;
  /** Repo-relative file path, leading slash stripped. */
  path: string;
  /** Line number from a `#L42` anchor, or null when absent. */
  line: number | null;
}

/** A link to a test file (VALIDATED_BY edge source). */
export type TestLinkRef = SpecLinkRef;

/** A link to a non-test source file (IMPLEMENTED_BY edge source). */
export type CodeLinkRef = SpecLinkRef;

const LINK_INSIDE_PAREN_RE = /\[([^\]]+)\]\(([^)]+)\)/g;

/** Find the trailing balanced parenthetical at the end of the statement,
 * tolerating an optional period + trailing whitespace. Markdown links
 * themselves contain `()`, so a naive `\(([^()]*)\)` regex fails — this
 * walks backward and counts paren depth. */
function findTrailingParenInner(s: string): string | null {
  let end = s.length;
  while (end > 0 && /[\s.]/.test(s[end - 1])) end--;
  if (end === 0 || s[end - 1] !== ")") return null;

  let depth = 1;
  for (let i = end - 2; i >= 0; i--) {
    const c = s[i];
    if (c === ")") depth++;
    else if (c === "(") {
      depth--;
      if (depth === 0) return s.slice(i + 1, end - 1);
    }
  }
  return null;
}

function parseLinksInStatement(
  statement: string,
  keepPath: (path: string) => boolean,
): SpecLinkRef[] {
  const inner = findTrailingParenInner(statement);
  if (inner === null) return [];

  const refs: SpecLinkRef[] = [];
  for (const match of inner.matchAll(LINK_INSIDE_PAREN_RE)) {
    const label = match[1].replace(/\s+/g, " ").trim();
    const href = match[2].trim();
    const hashIdx = href.indexOf("#L");
    const rawPath = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
    const path = rawPath.replace(/^\/+/, "");
    if (!keepPath(path)) continue;

    let line: number | null = null;
    if (hashIdx >= 0) {
      const n = Number(href.slice(hashIdx + 2));
      line = Number.isFinite(n) ? n : null;
    }
    refs.push({ label, path, line });
  }
  return refs;
}

/** Keeps only links whose path is a test file (VALIDATED_BY edges). */
export function parseTestLinksInStatement(statement: string): TestLinkRef[] {
  return parseLinksInStatement(statement, isTestFile);
}

/** Keeps only links whose path is NOT a test file (IMPLEMENTED_BY edges). */
export function parseCodeLinksInStatement(statement: string): CodeLinkRef[] {
  return parseLinksInStatement(statement, (path) => !isTestFile(path));
}
