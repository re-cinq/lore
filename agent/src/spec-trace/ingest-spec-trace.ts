/**
 * spec-traceability-graph end-to-end wiring — the thin dispatcher behind the
 * agent's `/api/trigger/spec-trace` handler. Routes a posted payload to the
 * right ingest function by `kind`. The `"test-report"` and `"coverage"`
 * branches exist; unknown-kind handling is a later facet.
 */

import type { CoveredChunk, DgraphClientPort } from "@re-cinq/lore-shared";
import { ingestTestReport, type TestReport } from "./ingest-test-report.js";
import { ingestCoverageReport } from "./ingest-coverage.js";

export async function ingestSpecTrace(
  dgraph: DgraphClientPort,
  repo: string,
  kind: string,
  payload: unknown,
): Promise<void> {
  if (kind === "test-report") {
    await ingestTestReport(dgraph, repo, payload as TestReport);
  }
  if (kind === "coverage") {
    const report = payload as { commit?: string; coverage?: { test: string; covered: CoveredChunk[] }[] };
    await ingestCoverageReport(
      dgraph,
      { repo, tool: "coverage-report", commit: report.commit ?? "" },
      // bulk coverage groups carry only `test`, so testFile = testName = group.test; COVERS edges derive from `covered` ranges
      (report.coverage ?? []).map((group) => ({ testFile: group.test, testName: group.test, covered: group.covered })),
    );
  }
}
