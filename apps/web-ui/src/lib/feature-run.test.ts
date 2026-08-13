import { describe, it, expect } from "vitest";
import {
  fetchFeatureRun,
  runTaskIdFor,
  toFeatureRunPayload,
} from "./feature-run";
import type {
  AssemblyLineRun,
  AssemblyLineRunNode,
} from "./assembly-line-runs";

const planningRun: AssemblyLineRun = {
  id: "ae7918b1-4baa-41fc-8b34-deb1be4cddf9",
  definitionName: "feature-planning",
  taskId: "e25bc81a-469a-42a8-ab08-ed824b2160d8",
  repo: "re-cinq/lore",
  branch: "lore/feature-planning/assembly-lines-live-view",
  status: "running",
  outcome: null,
  reason: null,
  createdAt: "2026-08-10T13:13:31.702Z",
  startedAt: "2026-08-10T13:13:35.000Z",
  durationSeconds: null,
  prUrl: null,
  prNumber: null,
  createdBy: "gedaiu",
  costUsd: null,
};

const analyzeNode: AssemblyLineRunNode = {
  nodeId: "analyze",
  iteration: 1,
  outcome: null,
  agentCrName: "ae7918b1-4ba-analyze",
  commitSha: null,
  durationSeconds: null,
  startedAt: "2026-08-10T13:13:40.873Z",
};

describe("toFeatureRunPayload", () => {
  it("resolves the declared feature-planning graph for a run with no visit rows", () => {
    expect(toFeatureRunPayload(planningRun, [])).toMatchObject({
      id: planningRun.id,
      status: "running",
      startedAt: "2026-08-10T13:13:35.000Z",
      repo: "re-cinq/lore",
      reason: null,
      synthetic: false,
      nodes: [],
      definition: {
        name: "feature-planning",
        entry: "analyze",
        exit: "done",
        edges: [{ from: "analyze", to: "done", on: "always" }],
      },
    });
  });

  it("keeps the visit rows so the panel can colour the nodes", () => {
    expect(toFeatureRunPayload(planningRun, [analyzeNode]).nodes).toEqual([
      analyzeNode,
    ]);
  });

  it("marks a run of an unknown definition synthetic", () => {
    const custom = { ...planningRun, definitionName: "bespoke-line" };

    expect(toFeatureRunPayload(custom, [analyzeNode])).toMatchObject({
      synthetic: true,
      definition: { name: "bespoke-line", entry: "analyze" },
    });
  });

  it("skips the lookup entirely for a round with no task yet", async () => {
    expect(await fetchFeatureRun(null)).toBeNull();
    expect(await fetchFeatureRun(undefined)).toBeNull();
    expect(await fetchFeatureRun("")).toBeNull();
  });

  it("carries the failure reason of a finished line", () => {
    const failed = {
      ...planningRun,
      status: "finished",
      outcome: "failed",
      reason: 'node "analyze" failed',
    };

    expect(toFeatureRunPayload(failed, [analyzeNode])).toMatchObject({
      status: "finished",
      reason: 'node "analyze" failed',
    });
  });
});

describe("runTaskIdFor", () => {
  it("uses the round's own task when it has one", () => {
    // Legacy features mint a task per round, and that round's own line is the one
    // to draw.
    expect(
      runTaskIdFor({ latestIterationTaskId: "task-7", owningTaskId: "task-1" }),
    ).toBe("task-7");
  });

  it("falls back to the line's owning task for a resumed round", () => {
    // The bug. On the merged line a refine is a RESUME: the API returns
    // task_id: null and nothing attaches one, so the latest round names no task and
    // the run graph vanished from round 2 onward. The line belongs to the first
    // round's task for its whole life.
    expect(
      runTaskIdFor({ latestIterationTaskId: null, owningTaskId: "task-1" }),
    ).toBe("task-1");
  });

  it("returns null for a feature whose rounds name no task at all", () => {
    expect(
      runTaskIdFor({ latestIterationTaskId: null, owningTaskId: null }),
    ).toBeNull();
  });

  it("treats absent and null the same", () => {
    expect(runTaskIdFor({})).toBeNull();
    expect(runTaskIdFor({ owningTaskId: "task-1" })).toBe("task-1");
  });

  it("ignores an empty task id rather than resolving a run for it", () => {
    expect(
      runTaskIdFor({ latestIterationTaskId: "", owningTaskId: "task-1" }),
    ).toBe("task-1");
  });
});
