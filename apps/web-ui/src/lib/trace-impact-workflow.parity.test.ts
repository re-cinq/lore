import { describe, it, expect } from "vitest";
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
