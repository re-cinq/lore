import { describe, it, expect } from "vitest";
import {
  incomingFailureOf,
  priorOutcomeOf,
  withIncomingFailure,
} from "./launch-spec.js";

const visit = (
  nodeId: string,
  outcome: string | null,
  failureDetail?: string,
) => ({ nodeId, outcome, failureDetail });

describe("incomingFailureOf", () => {
  it("names the failure that just routed here, from ANOTHER node", () => {
    // The case the implementation loop could not converge on: `implement`
    // succeeded, `validate` failed, and the retried `implement` was told
    // nothing — because its OWN last outcome was "success".
    const visits = [
      visit("implement", "success"),
      visit("validate", "failed", "validation failed: lint,build"),
    ];

    expect(incomingFailureOf(visits)).toEqual({
      nodeId: "validate",
      detail: "validation failed: lint,build",
    });
    // The contrast that made this necessary:
    expect(priorOutcomeOf(visits, "implement")).toBe("success");
  });

  it("is null when the most recent recorded visit succeeded", () => {
    expect(
      incomingFailureOf([
        visit("validate", "failed", "old news"),
        visit("implement", "success"),
      ]),
    ).toBeNull();
  });

  it("ignores the OPEN row, which is the current visit rather than a prior one", () => {
    expect(
      incomingFailureOf([
        visit("validate", "failed", "lint"),
        visit("implement", null),
      ]),
    ).toEqual({ nodeId: "validate", detail: "lint" });
  });

  it("is null with nothing recorded, and when the failure carried no detail", () => {
    expect(incomingFailureOf([])).toBeNull();
    expect(incomingFailureOf([visit("validate", "failed")])).toBeNull();
  });

  it("treats a kind-prefixed failure as a failure, but not changes_requested", () => {
    expect(
      incomingFailureOf([visit("review", "review-failed", "boom")]),
    ).toMatchObject({ nodeId: "review" });
    expect(
      incomingFailureOf([visit("await-pr", "changes_requested", "blocked")]),
    ).toBeNull();
  });
});

describe("withIncomingFailure", () => {
  it("returns the prompt untouched when nothing failed before it", () => {
    expect(withIncomingFailure("do the thing", null)).toBe("do the thing");
  });

  it("appends the failing step and its output to the prompt", () => {
    const out = withIncomingFailure("do the thing", {
      nodeId: "validate",
      detail: "validation failed: lint,build\n\n$ lint\nfoo.ts:1 error",
    });

    expect(out).toContain("do the thing");
    expect(out).toContain("The `validate` step failed on your last attempt");
    expect(out).toContain("foo.ts:1 error");
  });

  it("truncates a pathological detail rather than crowding out the instructions", () => {
    const out = withIncomingFailure("prompt", {
      nodeId: "validate",
      detail: "x".repeat(9000),
    });

    expect(out).toContain("...(truncated)");
    expect(out.length).toBeLessThan(3200);
  });
});
