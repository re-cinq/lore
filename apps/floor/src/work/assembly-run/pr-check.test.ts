import { describe, it, expect } from "vitest";
import { assemblyLineCheck, supersededCheck } from "./pr-check.js";
import type { RunGraph } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
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
    subjectKey: null,
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
    status: "running",
    clusterAgentId: null,
    requiredTags: [],
    claimedAt: null,
    outcome: null,
    input: null,
    failureClass: null,
    failureDetail: null,
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

  it("maps a completed line whose review node recorded changes_requested to a neutral conclusion (PR #938: reads the node row's verdict, not the line's own success)", () => {
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
      assemblyLineCheck(line({}), [], { uiUrl: "https://lore.example.com" }),
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

const loopGraph: RunGraph = {
  name: "implementation-loop",
  entry: "tdd-round",
  exit: "done",
  nodes: [
    {
      id: "tdd-round",
      type: "agent",
      station: "tdd-round",
      station_inherited: false,
      description: "ONE red-green-refactor round.",
    },
    {
      id: "await-ci",
      type: "ci_check",
      station: null,
      station_inherited: false,
      description: "Waiting on CI for the round just pushed.",
    },
  ],
  edges: [],
};

function loopRun(over: Partial<AssemblyRunRecord>): AssemblyRunRecord {
  return line({
    id: "694a406f",
    blueprintName: "implementation-loop",
    graph: loopGraph,
    args: { pr_number: 241 },
    ...over,
  });
}

describe("assemblyLineCheck for an implementation-loop run", () => {
  it("puts lore/implementation-loop on the pull request's live head sha 9dcdcc5", () => {
    expect(
      assemblyLineCheck(loopRun({}), [], { liveHeadSha: "9dcdcc5" }),
    ).toMatchObject({ headSha: "9dcdcc5", name: "lore/implementation-loop" });
  });

  it("returns null while the pull request's head is unknown", () => {
    expect(
      assemblyLineCheck(loopRun({}), [], { liveHeadSha: null }),
    ).toBeNull();
  });

  it("ignores a stale args.head_sha in favour of the live head", () => {
    expect(
      assemblyLineCheck(
        loopRun({ args: { pr_number: 241, head_sha: "old" } }),
        [],
        { liveHeadSha: "new" },
      ),
    ).toMatchObject({ headSha: "new" });
  });

  it("titles a running check with the description of await-ci, the step in flight", () => {
    expect(
      assemblyLineCheck(
        loopRun({}),
        [
          nodeRow({ nodeId: "tdd-round", iteration: 3, outcome: "success" }),
          nodeRow({ id: "n-2", nodeId: "await-ci", iteration: 3 }),
        ],
        { liveHeadSha: "9dcdcc5" },
      ),
    ).toMatchObject({
      status: "in_progress",
      title: "Waiting on CI for the round just pushed.",
      summary: expect.stringContaining("`await-ci` (visit 3)"),
    });
  });

  it("links the check to the run page /assembly-runs/694a406f", () => {
    expect(
      assemblyLineCheck(loopRun({}), [], {
        uiUrl: "https://lore.example.com",
        liveHeadSha: "9dcdcc5",
      }),
    ).toMatchObject({
      detailsUrl: "https://lore.example.com/assembly-runs/694a406f",
    });
  });

  it("maps a completed run to success even though a round recorded changes_requested", () => {
    expect(
      assemblyLineCheck(
        loopRun({ status: "finished", outcome: "completed" }),
        [nodeRow({ nodeId: "tdd-round", outcome: "changes_requested" })],
        { liveHeadSha: "9dcdcc5" },
      ),
    ).toMatchObject({ status: "completed", conclusion: "success" });
  });
});

describe("supersededCheck", () => {
  const check = {
    headSha: "new",
    name: "lore/implementation-loop",
    status: "in_progress" as const,
    title: "Waiting on CI.",
    summary: "Running.",
  };

  it("closes the check left on the previous head old as neutral once the head moves to new", () => {
    expect(
      supersededCheck(loopRun({ args: { pr_check_sha: "old" } }), check),
    ).toMatchObject({
      headSha: "old",
      name: "lore/implementation-loop",
      status: "completed",
      conclusion: "neutral",
      summary: expect.stringContaining("new"),
    });
  });

  it("returns null while the check is still on the head it was last published to", () => {
    expect(
      supersededCheck(loopRun({ args: { pr_check_sha: "new" } }), check),
    ).toBeNull();
  });

  it("returns null for a run that has never published a check", () => {
    expect(supersededCheck(loopRun({}), check)).toBeNull();
  });
});
