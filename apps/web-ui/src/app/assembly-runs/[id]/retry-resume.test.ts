import { describe, it, expect } from "vitest";
import { retryResumeSource } from "./retry-resume";

const visit = (nodeId: string, iteration: number, outcome: string | null) => ({
  nodeId,
  iteration,
  outcome,
});

describe("retryResumeSource", () => {
  it("resolves await-pr as the kept prefix when retrying fix-ci, forking from the visit just before the dead node", () => {
    const visits = [
      visit("tdd-round", 1, "success"),
      visit("ready-for-review", 1, "failed"),
      visit("ready-for-review", 2, "success"),
      visit("await-pr", 1, "changes_requested"),
      visit("fix-ci", 1, "failed"),
      visit("retrospective", 1, "success"),
    ];

    expect(retryResumeSource(visits, "fix-ci")).toEqual({
      nodeId: "await-pr",
      iteration: 1,
    });
  });

  it("returns null for the entry node — there is no prefix to keep", () => {
    expect(
      retryResumeSource(
        [visit("dod", 1, "failed"), visit("done", 1, "success")],
        "dod",
      ),
    ).toBeNull();
  });

  it("returns null for a node the run never visited", () => {
    expect(
      retryResumeSource([visit("dod", 1, "success")], "validate"),
    ).toBeNull();
  });

  it("names the predecessor row by iteration (validate@1, not its latest row) when that node ran again later", () => {
    const visits = [
      visit("implement", 1, "success"),
      visit("validate", 1, "failed"),
      visit("implement", 2, "success"),
      visit("validate", 2, "failed"),
    ];

    expect(retryResumeSource(visits, "implement")).toEqual({
      nodeId: "validate",
      iteration: 1,
    });
  });

  it("retrying a self-looped node names its own earlier iteration, re-launching with a fresh budget for the spent back-edge", () => {
    const visits = [
      visit("implement", 1, "failed"),
      visit("implement", 2, "failed"),
    ];

    expect(retryResumeSource(visits, "implement")).toEqual({
      nodeId: "implement",
      iteration: 1,
    });
  });

  it("resolves through loop history when the predecessor's latest row is the one before", () => {
    const visits = [
      visit("implement", 1, "success"),
      visit("validate", 1, "failed"),
      visit("implement", 2, "success"),
      visit("validate", 2, "failed"),
    ];

    expect(retryResumeSource(visits, "validate")).toEqual({
      nodeId: "implement",
      iteration: 2,
    });
  });

  it("returns null while any visit in the kept prefix is still open", () => {
    const visits = [
      visit("implement", 1, null),
      visit("validate", 1, "failed"),
    ];

    expect(retryResumeSource(visits, "validate")).toBeNull();
  });
});
