import { describe, it, expect } from "vitest";
import {
  incomingFailureOf,
  priorFailuresOf,
  priorOutcomeOf,
  withIncomingFailure,
  withPriorFailures,
} from "./launch-spec.js";

const visit = (
  nodeId: string,
  outcome: string | null,
  failureDetail?: string,
  iteration = 1,
) => ({ nodeId, iteration, outcome, failureDetail });

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

describe("priorFailuresOf", () => {
  it("collects every failed attempt of the launched node, oldest first, skipping visits without detail", () => {
    const visits = [
      visit("implement", "failed", "tests red: foo.test.ts", 1),
      visit("validate", "failed", "someone else's failure", 1),
      visit("implement", "failed", undefined, 2),
      visit("implement", "failed", "lint: unused var", 3),
      visit("implement", null, undefined, 4),
    ];

    expect(priorFailuresOf(visits, "implement")).toEqual([
      { nodeId: "implement", iteration: 1, detail: "tests red: foo.test.ts" },
      { nodeId: "implement", iteration: 3, detail: "lint: unused var" },
    ]);
  });

  it("skips successful and changes_requested visits — only failures teach", () => {
    const visits = [
      visit("implement", "success", "not a failure", 1),
      visit("implement", "changes_requested", "revise", 2),
    ];

    expect(priorFailuresOf(visits, "implement")).toEqual([]);
  });
});

describe("withPriorFailures", () => {
  it("returns the prompt untouched with no prior failures", () => {
    expect(withPriorFailures("do the thing", [])).toBe("do the thing");
  });

  it("appends each earlier attempt with its iteration and detail", () => {
    const out = withPriorFailures("do the thing", [
      { nodeId: "implement", iteration: 1, detail: "tests red: foo.test.ts" },
      { nodeId: "implement", iteration: 2, detail: "lint: unused var" },
    ]);

    expect(out).toContain("do the thing");
    expect(out).toContain("Earlier attempts of this step failed");
    expect(out).toContain("Attempt 1");
    expect(out).toContain("tests red: foo.test.ts");
    expect(out).toContain("Attempt 2");
    expect(out).toContain("lint: unused var");
  });

  it("keeps only the last 3 attempts and truncates each pathological detail", () => {
    const failures = [1, 2, 3, 4].map((iteration) => ({
      nodeId: "implement",
      iteration,
      detail: `attempt-${iteration}: ` + "x".repeat(9000),
    }));
    const out = withPriorFailures("prompt", failures);

    expect(out).not.toContain("attempt-1:");
    expect(out).toContain("attempt-2:");
    expect(out).toContain("attempt-4:");
    expect(out).toContain("...(truncated)");
    expect(out.length).toBeLessThan(3 * 2700 + 600);
  });
});
