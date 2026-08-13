import { describe, it, expect } from "vitest";
// web-ui can't import the @re-cinq/lore-shared PACKAGE (workspace + Docker
// isolation), so lore-trace-impact.yml is hand-duplicated. This CI-only test
// (runs in a full checkout) imports shared's PURE module by file path — never
// the package — to keep the mirror in lockstep. The bytes matter: the web-ui
// "fix" button commits the MIRROR into repos while onboard commits the SHARED
// one, so a silent divergence ships two different workflows. Worse here than
// for ingest: the backend suppresses a stale client's findings outright, so a
// drifted mirror would hand repos a workflow that stays switched off.
import * as mirror from "./trace-impact-workflow";
import * as canonical from "../../../../libs/shared/src/trace-impact-workflow";

describe("trace-impact-workflow parity (web-ui mirror vs shared canonical)", () => {
  it("shares the workflow path and canonical version", () => {
    expect(mirror.TRACE_IMPACT_WORKFLOW_PATH).toBe(
      canonical.TRACE_IMPACT_WORKFLOW_PATH,
    );
    expect(mirror.TRACE_IMPACT_WORKFLOW_VERSION).toBe(
      canonical.TRACE_IMPACT_WORKFLOW_VERSION,
    );
  });

  it("shares the workflow content byte for byte", () => {
    expect(mirror.TRACE_IMPACT_WORKFLOW_CONTENT).toBe(
      canonical.TRACE_IMPACT_WORKFLOW_CONTENT,
    );
  });

  it.each([
    null,
    "",
    "no marker at all",
    "# lore-trace-impact-version: 1\nold",
    "# lore-trace-impact-version: 99\nnewer",
  ])("classifies installed content %j identically", (content) => {
    expect(mirror.traceImpactWorkflowStatus(content)).toEqual(
      canonical.traceImpactWorkflowStatus(content),
    );
    expect(mirror.parseTraceImpactWorkflowVersion(content ?? "")).toEqual(
      canonical.parseTraceImpactWorkflowVersion(content ?? ""),
    );
  });

  it("classifies a version-1 workflow as stale, so the fix button offers it", () => {
    expect(
      mirror.traceImpactWorkflowStatus("# lore-trace-impact-version: 1\n"),
    ).toBe("stale");
  });

  it("classifies the canonical content as aligned on both sides", () => {
    expect(
      mirror.traceImpactWorkflowStatus(canonical.TRACE_IMPACT_WORKFLOW_CONTENT),
    ).toBe("aligned");
    expect(
      canonical.traceImpactWorkflowStatus(mirror.TRACE_IMPACT_WORKFLOW_CONTENT),
    ).toBe("aligned");
  });
});
