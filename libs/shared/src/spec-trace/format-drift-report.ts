/**
 * spec-traceability-graph Phase 7 (T273) — formats graph-sourced drift findings
 * (statements the traceability graph marks violated/drifted) into a `spec-drift`
 * issue body. Sibling of `formatBrokenLinksReport`; empty findings → "" (no issue).
 */
export interface DriftedStatement {
  specPath: string;
  ordinal: number;
  statementText: string;
  reason: string;
}

export function formatSpecDriftReport(drifted: DriftedStatement[]): string {
  if (drifted.length === 0) {
    return "";
  }
  const bySpec = new Map<string, DriftedStatement[]>();

  for (const finding of drifted) {
    const list = bySpec.get(finding.specPath) ?? [];

    list.push(finding);
    bySpec.set(finding.specPath, list);
  }
  const lines: string[] = [
    "**Spec statements drifted from their validating tests**",
    "",
    `${drifted.length} statement${drifted.length === 1 ? "" : "s"} across ${bySpec.size} spec${bySpec.size === 1 ? "" : "s"} no longer hold against their tests.`,
    "",
  ];

  for (const [specPath, list] of bySpec) {
    lines.push(`### \`${specPath}\``);
    lines.push("");

    for (const finding of list) {
      lines.push(`- **${finding.reason}** — _${finding.statementText}_`);
    }
    lines.push("");
  }
  lines.push("---");
  lines.push(
    "Posted by Lore's `spec-trace` job. Re-align the implementation with the spec or update the test to silence this.",
  );

  return lines.join("\n");
}
