/** End-to-end spec-traceability-graph wiring; routes payload to ingest function by kind, and into `main` or a per-run overlay by whether the payload names an assembly run. */

import type {
  CoveredChunk,
  DgraphClientPort,
} from "../../outbound/spec-trace/deps.js";
import {
  isOverlay,
  mainScope,
  overlayScope,
  type TraceScope,
} from "../../domain/spec-trace/trace-scope.js";
import { ingestTestReport, type TestReport } from "./ingest-test-report.js";
import { ingestCoverageReport } from "./ingest-coverage.js";
import { upsertOverlay } from "./overlay.js";

/** Normalized graph effect of one ingest, surfaced for logging + audit. */
export interface SpecTraceOutcome {
  kind: string;
  testChunks: number;
  validatedBy: number;
  violated: number;
  coverageNodes: number;
  coversEdges: number;
  /** The run whose overlay this ingest wrote into; absent when it wrote `main`. */
  assemblyRunId?: string;
}

/** The fields any ingested payload may carry to place itself on a branch rather than on `main`. */
interface ScopedPayload {
  assemblyRunId?: string;
  branch?: string;
  commit?: string;
}

/** Shape of the bulk `"coverage"` payload posted to the dispatcher. */
interface CoveragePayload extends ScopedPayload {
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

/** A coverage-only payload. The test counts are zero rather than absent: this kind carries no descriptors, and reporting it as having validated nothing is what distinguishes it from a test report whose tests all failed. */
async function ingestCoverageKind(
  dgraph: DgraphClientPort,
  scope: TraceScope,
  report: CoveragePayload,
): Promise<SpecTraceOutcome> {
  const result = await ingestCoverageReport(
    dgraph,
    { scope, tool: "coverage-report", commit: report.commit ?? "" },
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

/** A test-report payload: the descriptors, their results, and the spec links they carry. */
async function ingestTestReportKind(
  dgraph: DgraphClientPort,
  scope: TraceScope,
  payload: unknown,
): Promise<SpecTraceOutcome> {
  const result = await ingestTestReport(dgraph, scope, payload as TestReport);

  return { kind: "test-report", ...result };
}

/** Where this payload writes: its own run overlay when it names an assembly run, else the repo's `main` graph. */
function scopeFor(repo: string, payload: ScopedPayload): TraceScope {
  return payload.assemblyRunId
    ? overlayScope(repo, payload.assemblyRunId)
    : mainScope(repo);
}

/** Stamps the run's overlay anchor with the branch head its ranges are expressed in, BEFORE the chunks land, so a crashed ingest still leaves an anchor the sweep can find and drop. */
async function anchorOverlay(
  dgraph: DgraphClientPort,
  scope: TraceScope,
  payload: ScopedPayload,
): Promise<void> {
  if (!isOverlay(scope)) {
    return;
  }
  await upsertOverlay(dgraph, scope, {
    branch: payload.branch ?? "",
    headCommit: payload.commit ?? "",
  });
}

async function ingestByKind(
  dgraph: DgraphClientPort,
  scope: TraceScope,
  kind: string,
  payload: unknown,
): Promise<SpecTraceOutcome> {
  switch (kind) {
    case "test-report":
      return ingestTestReportKind(dgraph, scope, payload);
    case "coverage":
      return ingestCoverageKind(dgraph, scope, payload as CoveragePayload);
    default:
      throw new Error(`ingestSpecTrace: unrecognized kind "${kind}"`);
  }
}

export async function ingestSpecTrace(
  dgraph: DgraphClientPort,
  repo: string,
  kind: string,
  payload: unknown,
): Promise<SpecTraceOutcome> {
  const scoped = (payload ?? {}) as ScopedPayload;
  const scope = scopeFor(repo, scoped);

  await anchorOverlay(dgraph, scope, scoped);

  const outcome = await ingestByKind(dgraph, scope, kind, payload);

  return scope.assemblyRunId
    ? { ...outcome, assemblyRunId: scope.assemblyRunId }
    : outcome;
}
