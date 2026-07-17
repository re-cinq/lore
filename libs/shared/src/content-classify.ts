/**
 * Canonical content-type classifier for ingested files. Single source of
 * truth shared by the mcp-server ingest path (`ingest.ts`) and the agent
 * nightly reindex (`reindex.ts`) — previously duplicated in both plus a
 * third copy inside a test, which let the implementations drift.
 *
 * Source code is classified by extension FIRST, so a source file that
 * happens to live under a directory named `specs/`, `adrs/`, or `runbooks/`
 * (e.g. `web-ui/src/app/specs/page.tsx`) is `'code'`, never a doc/spec/adr.
 * The directory rules only apply to non-code files (markdown, yaml).
 */

export type ContentType = "doc" | "adr" | "spec" | "code";

const BINARY_RE =
  /\.(png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|pdf|zip|tar|gz|lock)$/i;
const CODE_RE =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|go|sh|rs|java|rb|kt|c|cpp|h|hpp|css|scss|sass|less)$/;

export function classifyFile(path: string): ContentType | null {
  // Retired docs live in the repo-root graveyard/ and must never be indexed.
  if (path.startsWith("graveyard/")) {
    return null;
  }

  if (BINARY_RE.test(path)) {
    return null;
  }

  if (
    path.endsWith("CLAUDE.md") ||
    path.endsWith("AGENTS.md") ||
    path.endsWith("CODEOWNERS")
  ) {
    return "doc";
  }

  // Extension wins over directory: a source file is code wherever it lives.
  if (CODE_RE.test(path)) {
    return "code";
  }

  if (/(?:^|\/)adrs\//.test(path)) {
    return "adr";
  }

  if (/(?:^|\/)specs\//.test(path) || path.startsWith(".specify/")) {
    return "spec";
  }

  if (/(?:^|\/)runbooks\//.test(path)) {
    return "doc";
  }

  if (path.endsWith(".md") || path.endsWith(".yaml") || path.endsWith(".yml")) {
    return "doc";
  }

  return null;
}
