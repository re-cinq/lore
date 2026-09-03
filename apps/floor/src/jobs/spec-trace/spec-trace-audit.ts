/** Pure formatters surfacing a spec-trace ingest's real graph effect (ADR-023 observability follow-up): turns the once-discarded SpecTraceOutcome into a one-line log + `spec_trace_ingest` audit row. */

import type {
  SpecTraceOutcome,
  IngestGraphSummary,
} from "@re-cinq/lore-shared";
import type { AuditLogEntry } from "@re-cinq/lore-shared/project/audit/audit-port.js";

export function specTraceAuditEntry(
  repo: string,
  outcome: SpecTraceOutcome,
): AuditLogEntry {
  return {
    event_type: "spec_trace_ingest",
    repo,
    payload: {
      kind: outcome.kind,
      test_chunks: outcome.testChunks,
      validated_by: outcome.validatedBy,
      violated: outcome.violated,
      coverage_nodes: outcome.coverageNodes,
      covers_edges: outcome.coversEdges,
    },
  };
}

export function specTraceLogLine(
  repo: string,
  outcome: SpecTraceOutcome,
): string {
  return (
    `[floor] spec-trace ${outcome.kind} ${repo}: ` +
    `validated_by=${outcome.validatedBy} violated=${outcome.violated} ` +
    `coverage_nodes=${outcome.coverageNodes} covers_edges=${outcome.coversEdges} test_chunks=${outcome.testChunks}`
  );
}

export function graphIngestAuditEntry(
  repo: string,
  summary: IngestGraphSummary,
): AuditLogEntry {
  return {
    event_type: "spec_trace_ingest",
    repo,
    payload: {
      kind: summary.kind,
      projected: summary.projected,
      skipped: summary.skipped,
      failed: summary.failed,
      status: summary.status,
    },
  };
}

export function graphIngestLogLine(
  repo: string,
  summary: IngestGraphSummary,
): string {
  return (
    `[floor] spec-trace ${summary.kind} ${repo}: ` +
    `projected=${summary.projected} skipped=${summary.skipped} failed=${summary.failed} status=${summary.status}`
  );
}
