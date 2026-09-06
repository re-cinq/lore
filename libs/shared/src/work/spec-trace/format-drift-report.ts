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

export function formatSpecDriftReport(drifted: DriftedStatement[]): string {
  if (drifted.length === 0) {
    return "";
  }
  const bySpec = groupBySpec(drifted);
  const lines: string[] = [
    "**Spec statements drifted from their validating tests**",
    "",
    `${pluralize(drifted.length, "statement")} across ${pluralize(bySpec.size, "spec")} no longer hold against their tests.`,
    "",
  ];

  for (const [specPath, list] of bySpec) {
    lines.push(`### \`${specPath}\``);
    lines.push("");
    lines.push(
      ...list.map(
        (finding) => `- **${finding.reason}** — _${finding.statementText}_`,
      ),
    );
    lines.push("");
  }
  lines.push("---");
  lines.push(
    "Posted by Lore's `spec-trace` job. Re-align the implementation with the spec or update the test to silence this.",
  );

  return lines.join("\n");
}
