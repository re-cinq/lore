import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findRepoRoot } from "./lib/repo-root.js";
import {
  TRACE_IMPACT_WORKFLOW_CONTENT,
  TRACE_IMPACT_WORKFLOW_PATH,
  TRACE_IMPACT_WORKFLOW_VERSION,
  parseTraceImpactWorkflowVersion,
} from "./trace-impact-workflow.js";

/**
 * The constant is what onboard commits into every repo; this repo's own
 * `.github/workflows/lore-trace-impact.yml` is its dogfood installation. The two
 * drifted apart at v1 — different vars name, different step ordering — while
 * both still carried `version: 1`, so `traceImpactWorkflowStatus` reported
 * "aligned" for a workflow that was not. A version integer a human maintains
 * cannot detect that; comparing the bytes can.
 */
describe("lore-trace-impact.yml parity", () => {
  const installed = readFileSync(
    join(findRepoRoot(), TRACE_IMPACT_WORKFLOW_PATH),
    "utf8",
  );

  it("installs byte-for-byte what the canonical constant declares", () => {
    expect(installed).toEqual(TRACE_IMPACT_WORKFLOW_CONTENT);
  });

  it("carries a first-line version marker matching the exported version", () => {
    expect(parseTraceImpactWorkflowVersion(installed)).toEqual(
      TRACE_IMPACT_WORKFLOW_VERSION,
    );
  });

  it("diffs against the merge base, never the base-branch tip", () => {
    expect(TRACE_IMPACT_WORKFLOW_CONTENT).toContain("git merge-base");
    expect(TRACE_IMPACT_WORKFLOW_CONTENT).not.toMatch(
      /git diff --unified=0 "\$BASE_SHA" "\$HEAD_SHA"/,
    );
  });

  it("declares protocol 2, so its findings are not suppressed as legacy", () => {
    expect(TRACE_IMPACT_WORKFLOW_CONTENT).toContain("d.protocol=2");
  });

  it("reads the graph baseline and marks each file aligned or not", () => {
    expect(TRACE_IMPACT_WORKFLOW_CONTENT).toContain("/impact/base");
    expect(TRACE_IMPACT_WORKFLOW_CONTENT).toContain("f.aligned =");
    expect(TRACE_IMPACT_WORKFLOW_CONTENT).toContain("ls-tree");
  });

  it("carries no literal NUL byte, which would make the file read as binary", () => {
    expect(TRACE_IMPACT_WORKFLOW_CONTENT).not.toContain("\u0000");
  });

  it("distinguishes an auth failure from an unavailable graph", () => {
    expect(TRACE_IMPACT_WORKFLOW_CONTENT).toContain("%{http_code}");
    expect(TRACE_IMPACT_WORKFLOW_CONTENT).toContain("lacks the write scope");
  });
});
