// Groups the per-file spec summaries from the /trace API into one card per spec
// folder: a spec like `specs/1-lore-platform/` holds spec.md + plan.md +
// data-model.md + tasks.md (+ checklists/, contracts/ …), and the list page shows
// it as a single card titled from spec.md, with every file listed in the card and
// coverage summed across the folder. Pure value-in/value-out.

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
  if (parts[0] === "specs" && parts.length > 2) return `specs/${parts[1]}`;
  return parts.length > 1 ? parts.slice(0, -1).join("/") : filePath;
}

/** spec.md first, then alphabetical — so the card's primary doc and file order are stable. */
function orderSpecFirst(a: SpecSummaryInput, b: SpecSummaryInput): number {
  const rank = (s: SpecSummaryInput) => (isSpecDoc(s.filePath) ? 0 : 1);
  return rank(a) - rank(b) || a.filePath.localeCompare(b.filePath);
}

function sumCoverage(items: SpecSummaryInput[]): SpecGroupCoverage {
  let testable = 0;
  let covered = 0;
  let untestable = 0;
  for (const { coverage } of items) {
    if (!coverage) continue;
    testable += coverage.testable;
    covered += coverage.covered;
    untestable += coverage.untestable ?? 0;
  }
  return {
    testable,
    covered,
    untestable,
    ratio: testable > 0 ? covered / testable : 0,
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
  for (const [key, items] of byKey) {
    const sorted = [...items].sort(orderSpecFirst);
    const primary = sorted.find((s) => isSpecDoc(s.filePath)) ?? sorted[0];
    groups.push({
      key,
      title: primary.title || basename(key),
      description: primary.description,
      coverage: sumCoverage(sorted),
      files: sorted.map((s) => ({ filePath: s.filePath, title: s.title })),
    });
  }
  return groups.sort((a, b) => a.key.localeCompare(b.key));
}
