/** Canonical content-type classifier (single source for ingest + reindex); source by extension first, dir rules only for non-code. */

export type ContentType = "doc" | "adr" | "spec" | "code";

const BINARY_RE =
  /\.(png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|pdf|zip|tar|gz|lock)$/i;
const CODE_RE =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|go|sh|rs|java|rb|kt|c|cpp|h|hpp|css|scss|sass|less)$/;

function isDocFile(path: string): boolean {
  return (
    path.endsWith("CLAUDE.md") ||
    path.endsWith("AGENTS.md") ||
    path.endsWith("CODEOWNERS")
  );
}

function isSpecPath(path: string): boolean {
  return /(?:^|\/)specs\//.test(path) || path.startsWith(".specify/");
}

function isMarkupDoc(path: string): boolean {
  return (
    path.endsWith(".md") || path.endsWith(".yaml") || path.endsWith(".yml")
  );
}

interface ClassifyRule {
  test: (path: string) => boolean;
  type: ContentType | null;
}

const CLASSIFY_RULES: ClassifyRule[] = [
  // Retired docs live in the repo-root graveyard/ and must never be indexed.
  { test: (path) => path.startsWith("graveyard/"), type: null },
  // Fixtures not content; fake links would be real rot to validator (#1015).
  {
    test: (path) => /(?:^|\/)(?:fixtures|__fixtures__)\//.test(path),
    type: null,
  },
  { test: (path) => BINARY_RE.test(path), type: null },
  { test: isDocFile, type: "doc" },
  // Extension wins over directory: a source file is code wherever it lives.
  { test: (path) => CODE_RE.test(path), type: "code" },
  { test: (path) => /(?:^|\/)adrs\//.test(path), type: "adr" },
  { test: isSpecPath, type: "spec" },
  { test: (path) => /(?:^|\/)runbooks\//.test(path), type: "doc" },
  { test: isMarkupDoc, type: "doc" },
];

export function classifyFile(path: string): ContentType | null {
  const rule = CLASSIFY_RULES.find((r) => r.test(path));

  return rule ? rule.type : null;
}

/** Read-side twin of classifyFile; drops exclusions (#1018: stale debris resurfacing as findings); auto-inherited. */
export function dropIngestExcluded<T extends { filePath: string }>(
  rows: T[],
): T[] {
  return rows.filter((r) => classifyFile(r.filePath) !== null);
}
