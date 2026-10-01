import { describe, expect, it } from "vitest";
import type { AssemblyRunSummary } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { floorRunFilters, matchesFloorQuery } from "./floor-run-query.js";

const RUN: AssemblyRunSummary = {
  id: "run-1",
  blueprintName: "code-review",
  taskId: null,
  repo: "re-cinq/lore",
  branch: "fix/login",
  subjectKey: null,
  args: { engine: "floor", pr_number: 412 },
  status: "running",
  outcome: null,
  reason: null,
  blueprintHash: "hash-1",
  resumedFromRunId: null,
  resumedFromNodeId: null,
  inheritedNodeCount: 0,
  createdAt: new Date("2026-09-30T10:00:00.000Z"),
  startedAt: new Date("2026-09-30T10:00:00.000Z"),
  finishedAt: null,
};

describe("floorRunFilters", () => {
  it("reads the open and the finished runs when the query names no filter", () => {
    expect(floorRunFilters({})).toEqual([{ open: true }, { open: false }]);
  });

  it("spells repo Re-Cinq/Lore as github.com/re-cinq/lore and the blueprint as the line", () => {
    expect(
      floorRunFilters({ repo: "Re-Cinq/Lore", blueprintName: "code-review" }),
    ).toEqual([
      { repo: "github.com/re-cinq/lore", line: "code-review", open: true },
      { repo: "github.com/re-cinq/lore", line: "code-review", open: false },
    ]);
  });

  it("reads one list per line for blueprints code-review and code-review-reply", () => {
    expect(
      floorRunFilters({
        blueprintName: ["code-review", "code-review-reply"],
        status: ["running"],
      }),
    ).toEqual([
      { line: "code-review", open: true },
      { line: "code-review-reply", open: true },
    ]);
  });

  it("reads the finished runs only for status failed", () => {
    expect(floorRunFilters({ status: ["failed"] })).toEqual([{ open: false }]);
  });

  it("names the subject pr_url:412 as the floor's subject", () => {
    expect(
      floorRunFilters({ subjectKey: "pr_url:412", status: ["queued"] }),
    ).toEqual([{ subject: "pr_url:412", open: true }]);
  });

  it("spells the plan subject plan:p1 as the floor's plan_id:p1, which is how a plan's own card finds its run", () => {
    expect(
      floorRunFilters({ subjectKey: "plan:p1", status: ["queued"] }),
    ).toEqual([{ subject: "plan_id:p1", open: true }]);
  });

  it("reads the runs keyed on subject task_id:task-1 for a query on task-1", () => {
    expect(floorRunFilters({ taskId: "task-1" })).toEqual([
      { subject: "task_id:task-1", open: true },
      { subject: "task_id:task-1", open: false },
    ]);
  });

  it("reads nothing for a query on a cluster-agent", () => {
    expect(floorRunFilters({ clusterAgentId: "agent-1" })).toEqual([]);
  });
});

describe("matchesFloorQuery", () => {
  it("rejects a running run when the status asked is queued", () => {
    expect(matchesFloorQuery(RUN, { status: ["queued"] })).toBe(false);
  });

  it("accepts a running run when the status asked is queued or running", () => {
    expect(matchesFloorQuery(RUN, { status: ["queued", "running"] })).toBe(
      true,
    );
  });

  it("rejects a run on fix/login when the branch asked is main", () => {
    expect(matchesFloorQuery(RUN, { branch: "main" })).toBe(false);
  });

  it("accepts a run on pull request 412 when the pull request asked is 412", () => {
    expect(matchesFloorQuery(RUN, { prNumber: 412 })).toBe(true);
  });

  it("rejects a run created at ten o'clock when created after eleven", () => {
    expect(
      matchesFloorQuery(RUN, {
        createdAfter: new Date("2026-09-30T11:00:00.000Z"),
      }),
    ).toBe(false);
  });
});
