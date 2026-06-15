import { describe, it, expect } from "vitest";
import {
  TRACE_IMPACT_WORKFLOW_PATH,
  TRACE_IMPACT_WORKFLOW_VERSION,
  TRACE_IMPACT_WORKFLOW_CONTENT,
  traceImpactWorkflowStatus,
  parseTraceImpactWorkflowVersion,
} from "./trace-impact-workflow.js";

describe("TRACE_IMPACT_WORKFLOW_CONTENT", () => {
  it("targets the workflows path", () => {
    expect(TRACE_IMPACT_WORKFLOW_PATH).toBe(".github/workflows/lore-trace-impact.yml");
  });

  it("carries the current version marker on the first line", () => {
    expect(TRACE_IMPACT_WORKFLOW_CONTENT.startsWith(`# lore-trace-impact-version: ${TRACE_IMPACT_WORKFLOW_VERSION}\n`)).toBe(true);
  });

  it("triggers on pull_request", () => {
    expect(TRACE_IMPACT_WORKFLOW_CONTENT).toContain("pull_request:");
  });

  it("posts the diff to the impact endpoint with the same secret/var wiring as ingest", () => {
    expect(TRACE_IMPACT_WORKFLOW_CONTENT).toContain("/api/repos/${{ github.repository }}/impact");
    expect(TRACE_IMPACT_WORKFLOW_CONTENT).toContain("LORE_INGEST_TOKEN: ${{ secrets.LORE_INGEST_TOKEN }}");
    expect(TRACE_IMPACT_WORKFLOW_CONTENT).toContain("LORE_INGEST_URL: ${{ vars.LORE_INGEST_URL }}");
  });

  it("renders an advisory neutral check (never blocks)", () => {
    expect(TRACE_IMPACT_WORKFLOW_CONTENT).toContain("conclusion: 'neutral'");
  });

  it("grants the permissions needed to post checks and PR comments", () => {
    expect(TRACE_IMPACT_WORKFLOW_CONTENT).toContain("checks: write");
    expect(TRACE_IMPACT_WORKFLOW_CONTENT).toContain("pull-requests: write");
  });
});

describe("parseTraceImpactWorkflowVersion", () => {
  it("reads the version from the marker line", () => {
    expect(parseTraceImpactWorkflowVersion("# lore-trace-impact-version: 3\nname: x")).toBe(3);
  });

  it("returns null when no marker is present", () => {
    expect(parseTraceImpactWorkflowVersion("name: Lore Spec Impact\non: pull_request")).toBeNull();
  });
});

describe("traceImpactWorkflowStatus", () => {
  it("returns missing when the file is absent", () => {
    expect(traceImpactWorkflowStatus(null)).toBe("missing");
  });

  it("returns stale when the marker version is older than current", () => {
    expect(traceImpactWorkflowStatus(`# lore-trace-impact-version: ${TRACE_IMPACT_WORKFLOW_VERSION - 1}\n`)).toBe("stale");
  });

  it("returns aligned for the canonical content", () => {
    expect(traceImpactWorkflowStatus(TRACE_IMPACT_WORKFLOW_CONTENT)).toBe("aligned");
  });
});
