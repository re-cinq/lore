import { describe, it, expect } from "vitest";
import { retryResumeSource } from "./retry-resume";

const visit = (nodeId: string, outcome: string | null) => ({ nodeId, outcome });

describe("retryResumeSource", () => {
  it("resolves await-pr as the kept prefix when retrying fix-ci", () => {
    // Run 52c3fdd5's walk: retrying the node that died forks from the visit
    // just before it.
    const visits = [
      visit("tdd-round", "success"),
      visit("ready-for-review", "failed"),
      visit("ready-for-review", "success"),
      visit("await-pr", "changes_requested"),
      visit("fix-ci", "failed"),
      visit("retrospective", "success"),
    ];

    expect(retryResumeSource(visits, "fix-ci")).toBe("await-pr");
  });

  it("returns null for the entry node — there is no prefix to keep", () => {
    expect(
      retryResumeSource(
        [visit("dod", "failed"), visit("done", "success")],
        "dod",
      ),
    ).toBeNull();
  });

  it("returns null for a node the run never visited", () => {
    expect(retryResumeSource([visit("dod", "success")], "validate")).toBeNull();
  });

  it("returns null when the preceding node ran again later — the fork API is node-granular", () => {
    // resumeFrom copies through the NAMED node's latest completed row; validate
    // ran again after implement's last visit, so naming validate would keep
    // more history than the retry target's prefix. Refuse rather than mis-fork.
    const visits = [
      visit("implement", "success"),
      visit("validate", "failed"),
      visit("implement", "success"),
      visit("validate", "failed"),
    ];

    expect(retryResumeSource(visits, "implement")).toBeNull();
  });

  it("resolves through loop history when the predecessor's latest row is the one before", () => {
    const visits = [
      visit("implement", "success"),
      visit("validate", "failed"),
      visit("implement", "success"),
      visit("validate", "failed"),
    ];

    expect(retryResumeSource(visits, "validate")).toBe("implement");
  });

  it("returns null while any visit in the kept prefix is still open", () => {
    const visits = [visit("implement", null), visit("validate", "failed")];

    expect(retryResumeSource(visits, "validate")).toBeNull();
  });
});
