/** Canonical content-type classifier (single source for ingest + reindex); source by extension first, dir rules only for non-code. */

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

  // Fixtures not content; fake links would be real rot to validator (#1015).
  if (/(?:^|\/)(?:fixtures|__fixtures__)\//.test(path)) {
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

/** Read-side twin of classifyFile; drops exclusions (#1018: stale debris resurfacing as findings); auto-inherited. */
export function dropIngestExcluded<T extends { filePath: string }>(
  rows: T[],
): T[] {
  return rows.filter((r) => classifyFile(r.filePath) !== null);
}
