/**
 * In-sync mirror of `shared/src/spec-link-parser.ts`. web-ui is not a
 * workspace member, so it can't import from `@re-cinq/lore-shared`.
 * Keep both copies in step. See web-ui/CLAUDE.md for the established
 * mirror pattern.
 */

/**
 * Pure parser for inline test-link parentheticals at the end of a
 * spec.md statement.
 *
 * v3 of `spec-test-coverage` puts the source of truth for the
 * spec → test link in markdown, inside the spec itself:
 *
 *     Returns the expected value.
 *     ([validated by `runner.test.ts:88`](mcp-server/src/runner.test.ts#L88))
 *
 * This function extracts those test-link tuples from a statement
 * string. The UI's rehype plugin uses it to know which `<a>` to
 * mark as a test link; the cron's validate pass uses it to resolve
 * each tuple against the AST chunks; the backfill cron's
 * `proposeLinkInsertions` uses it to know which statements already
 * carry a link and should NOT be backfilled.
 *
 * Format (locked by `spec-test-coverage` v3 §Decisions):
 *   - The parenthetical is at the END of the statement (the last
 *     `(...)` group on the line, optionally followed by a closing
 *     period).
 *   - Inside the parenthetical: one or more `[label](path#Lline)`
 *     markdown links, comma-separated.
 *   - Only links whose path passes `isTestFile()` count as test
 *     links; non-test links (ADR refs, docs links) are ignored.
 *
 * Returns an empty array when:
 *   - no trailing parenthetical, OR
 *   - the parenthetical contains no markdown links, OR
 *   - the parenthetical contains only non-test links.
 */

import { isTestFile } from "./test-paths";

export interface TestLinkRef {
  label: string;
  /** Repo-relative test file path, leading slash stripped. */
  path: string;
  /** Line number from a `#L42` anchor, or null when absent. */
  line: number | null;
}

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

export function parseTestLinksInStatement(statement: string): TestLinkRef[] {
  const inner = findTrailingParenInner(statement);
  if (inner === null) return [];

  const refs: TestLinkRef[] = [];
  for (const match of inner.matchAll(LINK_INSIDE_PAREN_RE)) {
    const label = match[1].replace(/\s+/g, " ").trim();
    const href = match[2].trim();
    const hashIdx = href.indexOf("#L");
    const rawPath = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
    const path = rawPath.replace(/^\/+/, "");
    if (!isTestFile(path)) continue;

    let line: number | null = null;
    if (hashIdx >= 0) {
      const n = Number(href.slice(hashIdx + 2));
      line = Number.isFinite(n) ? n : null;
    }
    refs.push({ label, path, line });
  }
  return refs;
}
