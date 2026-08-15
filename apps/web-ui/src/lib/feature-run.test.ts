// @vitest-environment node
//
// feature-run reaches assembly-line-runs, which now reads through the
// server-only lore-api client.

import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { fetchFeatureRun, runTaskIdFor, toFeatureRunPayload } =
  await import("./feature-run");

import type {
  AssemblyLineRun,
  AssemblyLineRunNode,
} from "./assembly-line-runs";
import { featurePlanningDefinition } from "./definition-fixtures";

const planningRun: AssemblyLineRun = {
  id: "ae7918b1-4baa-41fc-8b34-deb1be4cddf9",
  blueprintName: "feature-planning",
  // A real run carries its clone, stamped at start — so the wizard can draw the
  // whole graph before a single node row exists. That used to come from a
  // name lookup against a transcription of the yaml.
  graph: {
    name: featurePlanningDefinition.name,
    entry: featurePlanningDefinition.entry,
    exit: featurePlanningDefinition.exit,
    nodes: featurePlanningDefinition.nodes.map((node) => ({
      ...node,
      station: null,
      station_inherited: false,
    })),
    edges: featurePlanningDefinition.edges,
  },
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
        // The graph the RUN recorded. This assertion used to read
        // `[{ from: "analyze", to: "done" }]` — the hand-transcribed 2-node shape
        // that had not matched the definition for months.
        nodes: [
          { id: "analyze", type: "agent" },
          {
            id: "author",
            type: "feature_review",
            route: "/repos/{args.repo}/features/{args.feature_id}",
          },
          { id: "analyse-specs", type: "agent" },
          { id: "write", type: "agent" },
          { id: "push", type: "agent" },
          { id: "merged", type: "pr_review", route: "{args.pr_url}" },
          { id: "decompose", type: "agent" },
          { id: "issues", type: "issues" },
          { id: "done", type: "retrospective" },
        ],
      },
    });
  });

  it("keeps the visit rows so the panel can colour the nodes", () => {
    expect(toFeatureRunPayload(planningRun, [analyzeNode]).nodes).toEqual([
      analyzeNode,
    ]);
  });

  it("marks a run with no recorded graph synthetic", () => {
    // "Unknown definition" stopped being the interesting case once runs carry
    // their own graph: what matters now is a run stamped before clones existed,
    // whose blueprint is not recoverable from the row.
    const custom = {
      ...planningRun,
      blueprintName: "bespoke-line",
      graph: null,
    };

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
