import { describe, it, expect } from "vitest";
import { specTraceAuditEntry, specTraceLogLine } from "./spec-trace-audit.js";
import type { SpecTraceOutcome } from "@re-cinq/lore-shared";

const outcome: SpecTraceOutcome = {
  kind: "test-report",
  testChunks: 196,
  validatedBy: 102,
  violated: 3,
  coverageNodes: 50,
  coversEdges: 80,
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
      "[agent] spec-trace test-report re-cinq/lore: validated_by=102 violated=3 coverage_nodes=50 covers_edges=80 test_chunks=196",
    );
  });
});
