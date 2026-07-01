import { describe, it, expect } from "vitest";
import {
  specTraceAuditEntry,
  specTraceLogLine,
  graphIngestAuditEntry,
  graphIngestLogLine,
} from "./spec-trace-audit.js";
import type { SpecTraceOutcome, IngestGraphSummary } from "@re-cinq/lore-shared";

const outcome: SpecTraceOutcome = {
  kind: "test-report",
  testChunks: 196,
  validatedBy: 102,
  violated: 3,
  coverageNodes: 50,
  coversEdges: 80,
};

const summary: IngestGraphSummary = {
  kind: "adrs",
  projected: 4,
  skipped: 2,
  failed: 1,
  failedFiles: ["adrs/ADR-007.md"],
  status: "completed",
  message: "adrs: projected 4, skipped 2, failed 1",
};

describe("specTraceAuditEntry", () => {
  it("builds a spec_trace_ingest audit entry carrying the real graph counts", () => {
    expect(specTraceAuditEntry("re-cinq/lore", outcome)).toEqual({
      event_type: "spec_trace_ingest",
      repo: "re-cinq/lore",
      payload: { kind: "test-report", test_chunks: 196, validated_by: 102, violated: 3, coverage_nodes: 50, covers_edges: 80 },
    });
  });
});

describe("specTraceLogLine", () => {
  it("renders the counts in one line keyed by repo and kind", () => {
    expect(specTraceLogLine("re-cinq/lore", outcome)).toBe(
      "[floor] spec-trace test-report re-cinq/lore: validated_by=102 violated=3 coverage_nodes=50 covers_edges=80 test_chunks=196",
    );
  });
});

describe("graphIngestAuditEntry", () => {
  it("builds a spec_trace_ingest audit entry carrying the projection counts", () => {
    expect(graphIngestAuditEntry("re-cinq/lore", summary)).toEqual({
      event_type: "spec_trace_ingest",
      repo: "re-cinq/lore",
      payload: { kind: "adrs", projected: 4, skipped: 2, failed: 1, status: "completed" },
    });
  });
});

describe("graphIngestLogLine", () => {
  it("renders projection counts in one line keyed by repo and kind", () => {
    expect(graphIngestLogLine("re-cinq/lore", summary)).toBe(
      "[floor] spec-trace adrs re-cinq/lore: projected=4 skipped=2 failed=1 status=completed",
    );
  });
});
