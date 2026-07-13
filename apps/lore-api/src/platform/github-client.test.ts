import { describe, it, expect } from "vitest";
import {
  deriveComputedStatus,
  type PrCheck,
  type PrReview,
} from "./github-client.js";

const approved: PrReview = {
  user: "alice",
  state: "APPROVED",
  submitted_at: "",
};
const check = (conclusion: string | null, status = "completed"): PrCheck => ({
  name: "ci",
  status,
  conclusion,
});

describe("deriveComputedStatus", () => {
  it("is 'open', not 'approved', when a check is still running despite an approval", () => {
    // The reported bug: a null conclusion (in-progress) used to count as passing.
    expect(
      deriveComputedStatus({}, [check(null, "in_progress")], [approved]),
    ).toBe("open");
  });

  it("is 'approved' when every check has concluded success/skipped and there is an approval", () => {
    expect(
      deriveComputedStatus(
        {},
        [check("success"), check("skipped")],
        [approved],
      ),
    ).toBe("approved");
  });

  it("is 'approved' with an approval and no checks configured", () => {
    expect(deriveComputedStatus({}, [], [approved])).toBe("approved");
  });

  it("is 'checks-failing' when any check failed, regardless of approval", () => {
    expect(deriveComputedStatus({}, [check("failure")], [approved])).toBe(
      "checks-failing",
    );
  });

  it("is 'changes-requested' over 'approved' when both are present", () => {
    const changes: PrReview = {
      user: "bob",
      state: "CHANGES_REQUESTED",
      submitted_at: "",
    };
    expect(
      deriveComputedStatus({}, [check("success")], [approved, changes]),
    ).toBe("changes-requested");
  });

  it("prefers merged / closed / draft in that order", () => {
    expect(
      deriveComputedStatus({ merged: true, state: "closed" }, [], []),
    ).toBe("merged");
    expect(deriveComputedStatus({ state: "closed" }, [], [])).toBe("closed");
    expect(deriveComputedStatus({ draft: true }, [], [])).toBe("draft");
  });
});
