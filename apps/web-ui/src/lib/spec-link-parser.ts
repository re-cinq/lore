/**
 * In-sync mirror of `shared/src/spec-link-parser.ts`. web-ui is not a
 * workspace member, so it can't import from `@re-cinq/lore-shared`.
 * Keep both copies in step. See web-ui/CLAUDE.md for the established
 * mirror pattern.
 */

/**
 * Pure parsers for inline link parentheticals at the end of a spec.md
 * statement.
 *
 * v3 of `spec-test-coverage` puts the source of truth for the
 * spec → test/code link in markdown, inside the spec itself:
 *
 *     Returns the expected value.
 *     ([validated by `runner.test.ts:88`](mcp-server/src/runner.test.ts#L88))
 *
 * Test links (paths passing `isTestFile`) feed VALIDATED_BY edges; non-test,
 * non-doc source links feed IMPLEMENTED_BY edges.
 *
 * Format (locked by `spec-test-coverage` v3 §Decisions):
 *   - The parenthetical is at the END of the statement (the last
 *     `(...)` group on the line, optionally followed by a closing period).
 *   - Inside the parenthetical: one or more `[label](path#Lline)`
 *     markdown links, comma-separated.
 */

import { isTestFile, isDocFile } from "./test-paths";
import { segmentStatements, type Statement } from "./spec-segment";

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
 * tolerating an optional period + trailing whitespace. Returns the index of
 * the opening `(` and the inner content span, or null when there is none.
 * Markdown links themselves contain `()`, so a naive `\(([^()]*)\)` regex
 * fails — this walks backward and counts paren depth. */
function findTrailingParenSpan(
  s: string,
): { open: number; innerStart: number; innerEnd: number } | null {
  let end = s.length;

  while (end > 0 && /[\s.]/.test(s[end - 1])) {
    end--;
  }

  if (end === 0 || s[end - 1] !== ")") {
    return null;
  }

  let depth = 1;

  for (let i = end - 2; i >= 0; i--) {
    const c = s[i];

    if (c === ")") {
      depth++;
    } else if (c === "(") {
      depth--;

      if (depth === 0) {
        return { open: i, innerStart: i + 1, innerEnd: end - 1 };
      }
    }
  }

  return null;
}

/** Turn a `[label](path#Lline)` regex match into a normalized link ref. */
function linkRefFromMatch(match: RegExpMatchArray): SpecLinkRef {
  const label = match[1].replace(/\s+/g, " ").trim();
  const href = match[2].trim();
  const hashIdx = href.indexOf("#L");
  const rawPath = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
  const path = rawPath.replace(/^\/+/, "");
  let line: number | null = null;

  if (hashIdx >= 0) {
    const n = Number(href.slice(hashIdx + 2));

    line = Number.isFinite(n) ? n : null;
  }

  return { label, path, line };
}

function parseLinksInStatement(
  statement: string,
  keepPath: (path: string) => boolean,
): SpecLinkRef[] {
  const span = findTrailingParenSpan(statement);

  if (span === null) {
    return [];
  }
  const inner = statement.slice(span.innerStart, span.innerEnd);

  const refs: SpecLinkRef[] = [];

  for (const match of inner.matchAll(LINK_INSIDE_PAREN_RE)) {
    const ref = linkRefFromMatch(match);

    if (keepPath(ref.path)) {
      refs.push(ref);
    }
  }

  return refs;
}

/** Keeps only links whose path is a test file (VALIDATED_BY edges). */
export function parseTestLinksInStatement(statement: string): TestLinkRef[] {
  return parseLinksInStatement(statement, isTestFile);
}

/** Keeps only links whose path is source code — neither a test file nor
 * prose documentation (so ADR/docs `.md` refs do not become IMPLEMENTED_BY
 * code links). */
export function parseCodeLinksInStatement(statement: string): CodeLinkRef[] {
  return parseLinksInStatement(
    statement,
    (path) => !isTestFile(path) && !isDocFile(path),
  );
}

/** An href that can never be a repo-relative test path: an absolute URL
 * (`https://…`, or any `scheme:` form) or one of the placeholder shapes spec
 * prose uses to DOCUMENT the link convention itself (`path/to/test.ts`,
 * `<owner>`-style template segments). Intra-doc anchors (`#section`) fail
 * `isTestFile` on their own and need no extra rule. */
const NON_REPO_PATH_RE = /^[a-z][a-z0-9+.-]*:|^path(\/|#|$)|[<>]/i;

/** Find would-be VALIDATED_BY test links that sit in a NON-trailing
 * parenthetical, where the trailing-only parsers silently ignore them. Used
 * by the validate cron to warn authors about misplaced links. Only links
 * whose path is a real-looking test file are flagged: mid-prose references
 * to source files, prose docs, intra-doc anchors, absolute URLs, and
 * placeholder paths are legitimate spec prose, not misplaced coverage.
 * The scan covers only the text BEFORE the trailing parenthetical — a
 * `[...` bracket in prose would otherwise fuse with the trailing paren's
 * first real link into one bogus cross-boundary match — and inline code
 * spans are stripped first, since a link quoted in backticks never renders
 * as a link. */
export function findMisplacedCoverageLinks(statement: string): SpecLinkRef[] {
  const span = findTrailingParenSpan(statement);
  const trailingOpen = span ? span.open : statement.length;
  const scannable = statement.slice(0, trailingOpen).replace(/`[^`]*`/g, "");

  const refs: SpecLinkRef[] = [];

  for (const match of scannable.matchAll(LINK_INSIDE_PAREN_RE)) {
    const ref = linkRefFromMatch(match);

    if (!isTestFile(ref.path) || NON_REPO_PATH_RE.test(ref.path)) {
      continue;
    }
    refs.push(ref);
  }

  return refs;
}

/** Segment a spec's markdown and pair each statement with its trailing
 * test links — the shared loop behind both the validate cron and the
 * web-ui coverage derivation. */
export function linksForStatements(
  content: string,
): Array<{ statement: Statement; testLinks: TestLinkRef[] }> {
  return segmentStatements(content).map((statement) => ({
    statement,
    testLinks: parseTestLinksInStatement(statement.text),
  }));
}
