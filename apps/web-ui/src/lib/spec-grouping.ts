// Groups per-file spec summaries into one card per spec folder; shows spec.md coverage (not folder sum).

export interface SpecGroupCoverage {
  testable: number;
  covered: number;
  untestable: number;
  ratio: number;
}

/** One file inside a spec group (its path + its own document title). */
export interface SpecFileRef {
  filePath: string;
  title: string;
}

/** Minimal shape of a /trace spec summary this module reads (untestable is optional). */
export interface SpecSummaryInput {
  filePath: string;
  title: string;
  description: string;
  coverage?: {
    testable: number;
    covered: number;
    untestable?: number;
    ratio: number;
  };
}

/** One card: a spec folder, its document title, summed coverage, and every file. */
export interface SpecGroup {
  key: string;
  title: string;
  description: string;
  coverage: SpecGroupCoverage;
  files: SpecFileRef[];
}

const basename = (path: string): string => path.split("/").pop() ?? path;
const isSpecDoc = (path: string): boolean => basename(path) === "spec.md";

/** The spec folder a file belongs to: everything under `specs/<name>/` folds into `specs/<name>`; otherwise its directory. */
export function specGroupKey(filePath: string): string {
  const parts = filePath.split("/");

  if (parts[0] === "specs" && parts.length > 2) {
    return `specs/${parts[1]}`;
  }

  return parts.length > 1 ? parts.slice(0, -1).join("/") : filePath;
}

/** spec.md first, then alphabetical — so the card's primary doc and file order are stable. */
function orderSpecFirst(a: SpecSummaryInput, b: SpecSummaryInput): number {
  const rank = (s: SpecSummaryInput) => (isSpecDoc(s.filePath) ? 0 : 1);

  return rank(a) - rank(b) || a.filePath.localeCompare(b.filePath);
}

/** Card reports primary document's coverage only (spec.md under statement-link rules, not folder sum). */
function docCoverage({ coverage }: SpecSummaryInput): SpecGroupCoverage {
  if (!coverage) {
    return { testable: 0, covered: 0, untestable: 0, ratio: 0 };
  }

  return {
    testable: coverage.testable,
    covered: coverage.covered,
    untestable: coverage.untestable ?? 0,
    ratio: coverage.testable > 0 ? coverage.covered / coverage.testable : 0,
  };
}

/** Collapse per-file summaries into one card per spec folder, titled from spec.md. */
export function groupSpecSummaries(summaries: SpecSummaryInput[]): SpecGroup[] {
  const byKey = new Map<string, SpecSummaryInput[]>();

  for (const summary of summaries) {
    const key = specGroupKey(summary.filePath);

    (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(summary);
  }

  const groups: SpecGroup[] = [];

  for (const [key, specs] of byKey) {
    const sorted = [...specs].sort(orderSpecFirst);
    const primary = sorted.find((s) => isSpecDoc(s.filePath)) ?? sorted[0];

    groups.push({
      key,
      title: primary.title || basename(key),
      description: primary.description,
      coverage: docCoverage(primary),
      files: sorted.map((s) => ({ filePath: s.filePath, title: s.title })),
    });
  }

  return groups.sort((a, b) => a.key.localeCompare(b.key));
}
