/** spec-traceability-graph Phase 7 (T273) — formats graph-sourced drift findings into a `spec-drift` issue body; sibling of `formatBrokenLinksReport`, empty findings → "" (no issue). */
export interface DriftedStatement {
  specPath: string;
  ordinal: number;
  statementText: string;
  reason: string;
}

function groupBySpec(
  drifted: DriftedStatement[],
): Map<string, DriftedStatement[]> {
  const bySpec = new Map<string, DriftedStatement[]>();

  for (const finding of drifted) {
    const list = bySpec.get(finding.specPath) ?? [];

    list.push(finding);
    bySpec.set(finding.specPath, list);
  }

  return bySpec;
}

const pluralize = (count: number, word: string): string =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

const driftIntroLines = (total: number, specCount: number): string[] => [
  "**Spec statements drifted from their validating tests**",
  "",
  `${pluralize(total, "statement")} across ${pluralize(specCount, "spec")} no longer hold against their tests.`,
  "",
];

const driftSpecSection = (
  specPath: string,
  list: DriftedStatement[],
): string[] => [
  `### \`${specPath}\``,
  "",
  ...list.map(
    (finding) => `- **${finding.reason}** — _${finding.statementText}_`,
  ),
  "",
];

const DRIFT_FOOTER_LINES = [
  "---",
  "Posted by Lore's `spec-trace` job. Re-align the implementation with the spec or update the test to silence this.",
];

export function formatSpecDriftReport(drifted: DriftedStatement[]): string {
  if (drifted.length === 0) {
    return "";
  }
  const bySpec = groupBySpec(drifted);

  return [
    ...driftIntroLines(drifted.length, bySpec.size),
    ...[...bySpec].flatMap(([specPath, list]) =>
      driftSpecSection(specPath, list),
    ),
    ...DRIFT_FOOTER_LINES,
  ].join("\n");
}
