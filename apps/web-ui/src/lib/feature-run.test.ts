// @vitest-environment node
//
// feature-run reaches assembly-runs, which now reads through the
// server-only lore-api client.

import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { toFeatureRunPayload } = await import("./feature-run");

import type { AssemblyRun, AssemblyRunNode } from "./assembly-runs";
import { featurePlanningDefinition } from "./definition-fixtures";

const planningRun: AssemblyRun = {
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

const analyzeNode: AssemblyRunNode = {
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
