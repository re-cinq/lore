import { describe, it, expect } from "vitest";
import { decideGraphEmptyReason } from "./graph-empty-state";

describe("decideGraphEmptyReason", () => {
  it("reports never-projected when no kind has a commit", () => {
    expect(
      decideGraphEmptyReason({ specs: null, adrs: null, testReport: null }),
    ).toEqual({ kind: "never-projected" });
  });

  it("reports tests-only with the test commit when only the test report landed", () => {
    expect(
      decideGraphEmptyReason({
        specs: null,
        adrs: null,
        testReport: "579d822",
      }),
    ).toEqual({ kind: "tests-only", commit: "579d822" });
  });

  it("reports docs-unlinked with the spec commit when specs landed", () => {
    expect(
      decideGraphEmptyReason({
        specs: "abc1234",
        adrs: null,
        testReport: "579d822",
      }),
    ).toEqual({ kind: "docs-unlinked", commit: "abc1234" });
  });

  it("reports docs-unlinked with the adr commit when only adrs landed", () => {
    expect(
      decideGraphEmptyReason({
        specs: null,
        adrs: "def5678",
        testReport: null,
      }),
    ).toEqual({ kind: "docs-unlinked", commit: "def5678" });
  });
});
