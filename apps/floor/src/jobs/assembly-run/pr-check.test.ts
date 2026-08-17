import { describe, it, expect } from "vitest";
import { assemblyLineCheck } from "./pr-check.js";
import type {
  StationRunRecord,
  AssemblyRunRecord,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";

function line(over: Partial<AssemblyRunRecord>): AssemblyRunRecord {
  return {
    id: "al-1",
    graph: null,
    blueprintName: "code-review",
    taskId: null,
    repo: "re-cinq/lore",
    branch: "feat/x",
    args: { pr_number: 7, head_sha: "abc123" },
    status: "running",
    outcome: null,
    reason: null,
    blueprintHash: null,
    resumedFromRunId: null,
    resumedFromNodeId: null,
    inheritedNodeCount: 0,
    createdAt: new Date(0),
    startedAt: null,
    finishedAt: null,
    ...over,
  };
}

function nodeRow(over: Partial<StationRunRecord>): StationRunRecord {
  return {
    id: "n-1",
    stationRunId: "station-run-1",
    assemblyRunId: "al-1",
    nodeId: "review",
    iteration: 1,
    outcome: null,
    agentCrName: null,
    commitSha: null,
    startedAt: new Date(0),
    finishedAt: null,
    ...over,
  };
}

describe("assemblyLineCheck", () => {
  it("returns null when the line carries no pr_number", () => {
    expect(
      assemblyLineCheck(line({ args: { head_sha: "abc" } }), []),
    ).toBeNull();
  });

  it("returns null when the line carries no head_sha", () => {
    expect(assemblyLineCheck(line({ args: { pr_number: 7 } }), [])).toBeNull();
  });

  it("maps a running line to an in_progress check named lore/<definition>", () => {
    expect(assemblyLineCheck(line({ status: "running" }), [])).toMatchObject({
      headSha: "abc123",
      name: "lore/code-review",
      status: "in_progress",
    });
  });

  it("keeps a running line in_progress even when a node already recorded changes_requested", () => {
    expect(
      assemblyLineCheck(line({ status: "running" }), [
        nodeRow({ outcome: "changes_requested" }),
      ]),
    ).toMatchObject({ status: "in_progress" });
  });

  it("maps a changes_requested line outcome to a neutral conclusion", () => {
    expect(
      assemblyLineCheck(
        line({ status: "finished", outcome: "changes_requested" }),
        [],
      ),
    ).toMatchObject({ status: "completed", conclusion: "neutral" });
  });

  it("maps a completed line whose review node recorded changes_requested to a neutral conclusion", () => {
    // The production bug (PR #938): the walk routes changes_requested → done, so
    // the line closes with outcome "completed" and only the node row carries the
    // verdict — the check must not read success/"Approved." from the line alone.
    expect(
      assemblyLineCheck(line({ status: "finished", outcome: "completed" }), [
        nodeRow({ outcome: "changes_requested" }),
        nodeRow({ id: "n-2", nodeId: "done", outcome: "success" }),
      ]),
    ).toMatchObject({ status: "completed", conclusion: "neutral" });
  });

  it("reads the latest iteration of a node, so a re-reviewed success wins over an earlier changes_requested", () => {
    expect(
      assemblyLineCheck(line({ status: "finished", outcome: "completed" }), [
        nodeRow({ iteration: 1, outcome: "changes_requested" }),
        nodeRow({ id: "n-2", iteration: 2, outcome: "success" }),
      ]),
    ).toMatchObject({ status: "completed", conclusion: "success" });
  });

  it("maps a completed line to a success conclusion", () => {
    expect(
      assemblyLineCheck(line({ status: "finished", outcome: "completed" }), []),
    ).toMatchObject({ status: "completed", conclusion: "success" });
  });

  it("maps a failed line to a failure conclusion", () => {
    expect(
      assemblyLineCheck(line({ status: "failed", outcome: "error" }), []),
    ).toMatchObject({ status: "completed", conclusion: "failure" });
  });

  it("maps a failed line with a changes_requested node to a failure conclusion", () => {
    expect(
      assemblyLineCheck(line({ status: "failed", outcome: "error" }), [
        nodeRow({ outcome: "changes_requested" }),
      ]),
    ).toMatchObject({ status: "completed", conclusion: "failure" });
  });

  it("maps a finished line with outcome failed to a failure conclusion carrying the reason", () => {
    expect(
      assemblyLineCheck(
        line({
          status: "finished",
          outcome: "failed",
          reason: 'node "review" failed',
        }),
        [],
      ),
    ).toMatchObject({
      status: "completed",
      conclusion: "failure",
      summary: expect.stringContaining('node "review" failed'),
    });
  });

  it("adds the @lore review re-run hint to a failed code-review line", () => {
    const check = assemblyLineCheck(
      line({ status: "finished", outcome: "failed" }),
      [],
    );

    expect(check?.summary).toContain("@lore review");
  });

  it("maps a pr_closed outcome to a cancelled conclusion", () => {
    expect(
      assemblyLineCheck(line({ status: "finished", outcome: "pr_closed" }), []),
    ).toMatchObject({ status: "completed", conclusion: "cancelled" });
  });

  it("maps a pr_closed line with a changes_requested node to a cancelled conclusion", () => {
    expect(
      assemblyLineCheck(line({ status: "finished", outcome: "pr_closed" }), [
        nodeRow({ outcome: "changes_requested" }),
      ]),
    ).toMatchObject({ status: "completed", conclusion: "cancelled" });
  });

  it("adds a details_url to the Lore UI when a uiUrl is given", () => {
    expect(
      assemblyLineCheck(line({}), [], "https://lore.example.com"),
    ).toMatchObject({
      detailsUrl: "https://lore.example.com/assembly-runs/al-1",
    });
  });

  it("maps an iteration_max outcome to a failure conclusion", () => {
    expect(
      assemblyLineCheck(
        line({ status: "finished", outcome: "iteration_max" }),
        [],
      ),
    ).toMatchObject({ status: "completed", conclusion: "failure" });
  });
});

describe("assemblyLineCheck check-name alias", () => {
  it("publishes a code-review-recheck line under the aliased lore/code-review check name so a required check is refreshed", () => {
    expect(
      assemblyLineCheck(
        line({ blueprintName: "code-review-recheck", status: "running" }),
        [],
      ),
    ).toMatchObject({ name: "lore/code-review", title: "Lore code-review" });
  });
});
