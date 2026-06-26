/**
 * Pure formatters that surface a spec-trace ingest's real graph effect (ADR-023
 * observability follow-up). The agent's `/api/trigger/spec-trace` handler used
 * to discard `ingestSpecTrace`'s result; these turn the returned
 * {@link SpecTraceOutcome} into a one-line log and a `spec_trace_ingest` audit
 * row, so a run's true `validated_by`/`violated`/coverage counts are observable.
 */

import type { SpecTraceOutcome, IngestGraphSummary } from "@re-cinq/lore-shared";
import type { AuditLogEntry } from "../data/repositories/index.js";

export function specTraceAuditEntry(repo: string, outcome: SpecTraceOutcome): AuditLogEntry {
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

export function specTraceLogLine(repo: string, outcome: SpecTraceOutcome): string {
  return (
    `[agent] spec-trace ${outcome.kind} ${repo}: ` +
    `validated_by=${outcome.validatedBy} violated=${outcome.violated} ` +
    `coverage_nodes=${outcome.coverageNodes} covers_edges=${outcome.coversEdges} test_chunks=${outcome.testChunks}`
  );
}

export function graphIngestAuditEntry(repo: string, summary: IngestGraphSummary): AuditLogEntry {
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

export function graphIngestLogLine(repo: string, summary: IngestGraphSummary): string {
  return (
    `[agent] spec-trace ${summary.kind} ${repo}: ` +
    `projected=${summary.projected} skipped=${summary.skipped} failed=${summary.failed} status=${summary.status}`
  );
}
