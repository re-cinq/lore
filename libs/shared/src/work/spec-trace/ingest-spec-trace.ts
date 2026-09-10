/** End-to-end spec-traceability-graph wiring; routes payload to ingest function by kind, and into `main` or a per-run overlay by whether the payload names an assembly run. */

import type {
  CoveredChunk,
  DgraphClientPort,
} from "../../outbound/spec-trace/deps.js";
import { enforceTrue } from "../../lib/enforce.js";
import {
  isOverlay,
  mainScope,
  overlayScope,
  type TraceScope,
} from "../../domain/spec-trace/trace-scope.js";
import { ingestTestReport, type TestReport } from "./ingest-test-report.js";
import { ingestCoverageReport } from "./ingest-coverage.js";
import { dropOverlay, upsertOverlay } from "./overlay.js";
import {
  projectFailure,
  resolveFailures,
  type FailureRecord,
} from "./failure-nodes.js";

/** The kinds whose body travels as a payload rather than being read from the repo. Exported so the Floor's dispatcher and the ingest station agree with `ingestByKind` by construction instead of by two hand-kept copies. */
export const PAYLOAD_INGEST_KINDS: ReadonlySet<string> = new Set([
  "test-report",
  "coverage",
  "overlay-drop",
  "failure",
]);

/** The kinds that describe a BRANCH SNAPSHOT and so belong in a run's overlay. A failure is not one: it is a fact about the repo's history that outlives the run, and `overlay-drop` names the overlay it deletes rather than writing into it. */
const OVERLAY_SCOPED_KINDS: ReadonlySet<string> = new Set([
  "test-report",
  "coverage",
]);

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

/** A node's terminal outcome, as the Floor settles it. `outcome` is what tells a resolve from a new failure. */
interface FailurePayload extends FailureRecord {
  outcome: string;
}

/** Shape of the bulk `"coverage"` payload posted to the dispatcher. */
interface CoveragePayload extends ScopedPayload {
  coverage?: { test: string; covered: CoveredChunk[] }[];
}

/** What a kind that writes no chunks reports: the graph did not gain nodes, so every count is zero rather than absent. */
const NO_GRAPH_COUNTS = {
  testChunks: 0,
  validatedBy: 0,
  violated: 0,
  coverageNodes: 0,
  coversEdges: 0,
};

export async function ingestSpecTrace(
  dgraph: DgraphClientPort,
  repo: string,
  kind: string,
  payload: unknown,
): Promise<SpecTraceOutcome> {
  const scoped = (payload ?? {}) as ScopedPayload;
  const scope = scopeFor(repo, kind, scoped);

  if (kind !== "overlay-drop") {
    await anchorOverlay(dgraph, scope, scoped);
  }

  const outcome = await ingestByKind(dgraph, scope, kind, payload);

  return scope.assemblyRunId
    ? { ...outcome, assemblyRunId: scope.assemblyRunId }
    : outcome;
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
    case "overlay-drop":
      return dropOverlayKind(dgraph, scope.repo, payload as ScopedPayload);
    case "failure":
      return failureKind(dgraph, scope.repo, payload as FailurePayload);
    default:
      throw new Error(`ingestSpecTrace: unrecognized kind "${kind}"`);
  }
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

/** Projects bulk coverage payload to ingestCoverageReport record shape; testFile = testName = group.test. */
function coverageRecordsFromGroups(payload: CoveragePayload) {
  return (payload.coverage ?? []).map((group) => ({
    testFile: group.test,
    testName: group.test,
    covered: group.covered,
  }));
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

/** The run is over: its overlay and everything it anchored go. No counts to report — the graph shrank, it did not gain. */
async function dropOverlayKind(
  dgraph: DgraphClientPort,
  repo: string,
  payload: ScopedPayload,
): Promise<SpecTraceOutcome> {
  const assemblyRunId = payload.assemblyRunId ?? "";

  enforceTrue(
    assemblyRunId.length > 0,
    Error,
    "ingestSpecTrace: overlay-drop names no assemblyRunId",
  );
  await dropOverlay(dgraph, repo, assemblyRunId);

  return { kind: "overlay-drop", ...NO_GRAPH_COUNTS };
}

/** One node's terminal outcome as the graph records it: a green attempt stamps the sha onto what the earlier red attempts left, anything else projects a new failure. */
async function failureKind(
  dgraph: DgraphClientPort,
  repo: string,
  payload: FailurePayload,
): Promise<SpecTraceOutcome> {
  const settled = { kind: "failure", ...NO_GRAPH_COUNTS };

  if (payload.outcome === "success") {
    await resolveFailures(
      dgraph,
      repo,
      { assemblyRunId: payload.assemblyRunId, nodeId: payload.nodeId },
      payload.commit ?? "",
    );

    return settled;
  }
  await projectFailure(dgraph, repo, payload);

  return settled;
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

/** Where this payload writes: its own run overlay when it is a branch snapshot naming a run, else the repo's `main` graph. */
function scopeFor(
  repo: string,
  kind: string,
  payload: ScopedPayload,
): TraceScope {
  return payload.assemblyRunId && OVERLAY_SCOPED_KINDS.has(kind)
    ? overlayScope(repo, payload.assemblyRunId)
    : mainScope(repo);
}
