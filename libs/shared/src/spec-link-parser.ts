// Pure parser for inline link parentheticals at the end of a spec.md statement (spec-test-coverage v3 §Decisions): trailing `([label](path#Lline), ...)`, split into test links (VALIDATED_BY) vs code links (IMPLEMENTED_BY).
import { posix } from "node:path";
import { isTestFile, isDocFile } from "./test-paths.js";
import { segmentStatements, type Statement } from "./spec-segment.js";

/** Strip a leading `./` or `/` so repo-root-relative and dot-relative forms match. */
export function normalizePath(path: string): string {
  return path.replace(/^\.?\/+/, "");
}

// A `../`-climbing href is relative to the spec's own directory (as GitHub renders it), resolved against dirname(specPath); both the graph binder and the require-spec-link ESLint index resolve through here so they agree.
export function resolveLinkPath(linkPath: string, specPath: string): string {
  const stripped = linkPath.startsWith("./") ? linkPath.slice(2) : linkPath;

  if (stripped.startsWith("../")) {
    return posix.normalize(posix.join(posix.dirname(specPath), stripped));
  }

  return normalizePath(linkPath);
}

/** A resolved `[label](path#Lline)` link; shared shape for both test and code links. */
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

// Walks backward counting paren depth (a naive `\(([^()]*)\)` regex fails since markdown links themselves contain `()`); tolerates a trailing period + whitespace.
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
      continue;
    }

    if (c === "(" && depth === 1) {
      return { open: i, innerStart: i + 1, innerEnd: end - 1 };
    }

    if (c === "(") {
      depth--;
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

/** Keeps only source-code links — excludes test files and prose docs (so ADR/docs `.md` refs don't become IMPLEMENTED_BY links). */
export function parseCodeLinksInStatement(statement: string): CodeLinkRef[] {
  return parseLinksInStatement(
    statement,
    (path) => !isTestFile(path) && !isDocFile(path),
  );
}

// Excludes absolute URLs and placeholder shapes (`path/to/test.ts`, `<owner>`-style segments) that spec prose uses to document the link convention itself.
const NON_REPO_PATH_RE = /^[a-z][a-z0-9+.-]*:|^path(\/|#|$)|[<>]/i;

// Flags would-be VALIDATED_BY test links in a NON-trailing parenthetical (used by the validate cron); scans only text before the trailing paren, with inline code spans stripped first.
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

/** Shared loop behind both the validate cron and the web-ui coverage derivation. */
export function linksForStatements(
  content: string,
): Array<{ statement: Statement; testLinks: TestLinkRef[] }> {
  return segmentStatements(content).map((statement) => ({
    statement,
    testLinks: parseTestLinksInStatement(statement.text),
  }));
}
