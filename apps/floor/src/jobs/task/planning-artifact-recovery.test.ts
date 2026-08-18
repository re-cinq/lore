import { describe, it, expect } from "vitest";
import type { RunGraph } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import { decideArtifactRecovery } from "./planning-artifact-recovery.js";

const PLANNING_GRAPH: RunGraph = {
  name: "feature-planning",
  entry: "analyze",
  exit: "author",
  nodes: [
    {
      id: "analyze",
      type: "claude_code",
      station: "def-feature-planning",
      station_inherited: true,
    },
    {
      id: "author",
      type: "feature_review",
      station: null,
      station_inherited: false,
    },
  ],
  edges: [],
};

describe("decideArtifactRecovery", () => {
  it("recovers with the analyze CR when the run is parked on the author and the artifact never landed", () => {
    const decision = decideArtifactRecovery(
      [
        { nodeId: "analyze", outcome: "success", agentCrName: "cr-analyze-1" },
        { nodeId: "author", outcome: null, agentCrName: null },
      ],
      PLANNING_GRAPH,
      true,
    );

    expect(decision).toEqual({ kind: "recover", agentCrName: "cr-analyze-1" });
  });

  it("waits while the analyze node itself is still open on an open run", () => {
    const decision = decideArtifactRecovery(
      [{ nodeId: "analyze", outcome: null, agentCrName: "cr-analyze-1" }],
      PLANNING_GRAPH,
      true,
    );

    expect(decision).toEqual({ kind: "wait" });
  });

  it("recovers an open analyze row once the run has closed, so a lost node event does not bury the artifact", () => {
    const decision = decideArtifactRecovery(
      [{ nodeId: "analyze", outcome: null, agentCrName: "cr-analyze-1" }],
      PLANNING_GRAPH,
      false,
    );

    expect(decision).toEqual({ kind: "recover", agentCrName: "cr-analyze-1" });
  });

  it("returns none when the round's own analyze failed, never replaying an earlier round's success", () => {
    const decision = decideArtifactRecovery(
      [
        { nodeId: "analyze", outcome: "success", agentCrName: "cr-analyze-1" },
        { nodeId: "author", outcome: "changes_requested", agentCrName: null },
        { nodeId: "analyze", outcome: "failed", agentCrName: "cr-analyze-2" },
      ],
      PLANNING_GRAPH,
      false,
    );

    expect(decision).toEqual({ kind: "none" });
  });

  it("recovers with the NEWEST analyze CR on a multi-round run, not the first round's", () => {
    const decision = decideArtifactRecovery(
      [
        { nodeId: "analyze", outcome: "success", agentCrName: "cr-analyze-1" },
        { nodeId: "author", outcome: "changes_requested", agentCrName: null },
        { nodeId: "analyze", outcome: "success", agentCrName: "cr-analyze-2" },
        { nodeId: "author", outcome: null, agentCrName: null },
      ],
      PLANNING_GRAPH,
      true,
    );

    expect(decision).toEqual({ kind: "recover", agentCrName: "cr-analyze-2" });
  });

  it("returns none when the run has no rows at all", () => {
    const decision = decideArtifactRecovery([], PLANNING_GRAPH, true);

    expect(decision).toEqual({ kind: "none" });
  });

  it("falls back to CR presence as the work-row test when the run carries no graph", () => {
    const decision = decideArtifactRecovery(
      [
        { nodeId: "analyze", outcome: "success", agentCrName: "cr-analyze-1" },
        { nodeId: "author", outcome: null, agentCrName: null },
      ],
      null,
      true,
    );

    expect(decision).toEqual({ kind: "recover", agentCrName: "cr-analyze-1" });
  });
});
