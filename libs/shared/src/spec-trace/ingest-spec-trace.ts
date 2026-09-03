/** End-to-end spec-traceability-graph wiring; routes payload to ingest function by kind. */

import type { CoveredChunk, DgraphClientPort } from "./deps.js";
import { ingestTestReport, type TestReport } from "./ingest-test-report.js";
import { ingestCoverageReport } from "./ingest-coverage.js";

/** Normalized graph effect of one ingest, surfaced for logging + audit. */
export interface SpecTraceOutcome {
  kind: string;
  testChunks: number;
  validatedBy: number;
  violated: number;
  coverageNodes: number;
  coversEdges: number;
}

/** Shape of the bulk `"coverage"` payload posted to the dispatcher. */
interface CoveragePayload {
  commit?: string;
  coverage?: { test: string; covered: CoveredChunk[] }[];
}

/** Projects bulk coverage payload to ingestCoverageReport record shape; testFile = testName = group.test. */
function coverageRecordsFromGroups(payload: CoveragePayload) {
  return (payload.coverage ?? []).map((group) => ({
    testFile: group.test,
    testName: group.test,
    covered: group.covered,
  }));
}

export async function ingestSpecTrace(
  dgraph: DgraphClientPort,
  repo: string,
  kind: string,
  payload: unknown,
): Promise<SpecTraceOutcome> {
  switch (kind) {
    case "test-report": {
      const result = await ingestTestReport(
        dgraph,
        repo,
        payload as TestReport,
      );

      return { kind, ...result };
    }
    case "coverage": {
      const report = payload as CoveragePayload;
      const result = await ingestCoverageReport(
        dgraph,
        { repo, tool: "coverage-report", commit: report.commit ?? "" },
        coverageRecordsFromGroups(report),
      );

      return {
        kind,
        testChunks: 0,
        validatedBy: 0,
        violated: 0,
        coverageNodes: result.coverageNodes,
        coversEdges: result.coversEdges,
      };
    }
    default:
      throw new Error(`ingestSpecTrace: unrecognized kind "${kind}"`);
  }
}
