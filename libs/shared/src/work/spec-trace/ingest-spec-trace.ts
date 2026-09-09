/** End-to-end spec-traceability-graph wiring; routes payload to ingest function by kind. */

import type {
  CoveredChunk,
  DgraphClientPort,
} from "../../outbound/spec-trace/deps.js";
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

export async function ingestSpecTrace(
  dgraph: DgraphClientPort,
  repo: string,
  kind: string,
  payload: unknown,
): Promise<SpecTraceOutcome> {
  switch (kind) {
    case "test-report":
      return ingestTestReportKind(dgraph, repo, payload);
    case "coverage":
      return ingestCoverageKind(dgraph, repo, payload as CoveragePayload);
    default:
      throw new Error(`ingestSpecTrace: unrecognized kind "${kind}"`);
  }
}

/** A test-report payload: the descriptors, their results, and the spec links they carry. */
async function ingestTestReportKind(
  dgraph: DgraphClientPort,
  repo: string,
  payload: unknown,
): Promise<SpecTraceOutcome> {
  const result = await ingestTestReport(dgraph, repo, payload as TestReport);

  return { kind: "test-report", ...result };
}

/** A coverage-only payload. The test counts are zero rather than absent: this kind carries no descriptors, and reporting it as having validated nothing is what distinguishes it from a test report whose tests all failed. */
async function ingestCoverageKind(
  dgraph: DgraphClientPort,
  repo: string,
  report: CoveragePayload,
): Promise<SpecTraceOutcome> {
  const result = await ingestCoverageReport(
    dgraph,
    { repo, tool: "coverage-report", commit: report.commit ?? "" },
    coverageRecordsFromGroups(report),
  );

  return {
    kind: "coverage",
    testChunks: 0,
    validatedBy: 0,
    violated: 0,
    coverageNodes: result.coverageNodes,
    coversEdges: result.coversEdges,
  };
}

/** Projects bulk coverage payload to ingestCoverageReport record shape; testFile = testName = group.test. */
function coverageRecordsFromGroups(payload: CoveragePayload) {
  return (payload.coverage ?? []).map((group) => ({
    testFile: group.test,
    testName: group.test,
    covered: group.covered,
  }));
}
