import { describe, it, expect } from "vitest";
import type { AssemblyLine } from "@re-cinq/lore-assembly-lines";
import type { RunGraph } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import { graphForRun } from "./graph-for-run.js";

const storedGraph: RunGraph = {
  name: "code-review",
  entry: "review",
  exit: "done",
  nodes: [
    {
      id: "review",
      type: "agent",
      station: "code-review",
      station_inherited: true,
    },
  ],
  edges: [],
};

const blueprint: AssemblyLine = {
  name: "code-review",
  description: "test fixture",
  version: 1,
  entry: "review",
  exit: "review",
  nodes: [{ id: "review", type: "agent" }] as AssemblyLine["nodes"],
  edges: [],
};

describe("graphForRun", () => {
  it("returns the stored clone without ever loading the catalog", async () => {
    const graph = await graphForRun(
      { graph: storedGraph, blueprintName: "code-review" },
      () => {
        throw new Error(
          "the catalog must not load when the row carries its graph",
        );
      },
    );

    expect(graph).toBe(storedGraph);
  });

  it("snapshots the blueprint by name for a row stamped before clones existed", async () => {
    const graph = await graphForRun(
      { graph: null, blueprintName: "code-review" },
      async () => new Map([["code-review", blueprint]]),
    );

    expect(graph?.nodes).toEqual([
      {
        id: "review",
        type: "agent",
        station: "code-review",
        station_inherited: true,
      },
    ]);
  });

  it("returns undefined for a graph-less row whose blueprint no longer exists", async () => {
    const graph = await graphForRun(
      { graph: null, blueprintName: "deleted-blueprint" },
      async () => new Map<string, AssemblyLine>(),
    );

    expect(graph).toBeUndefined();
  });
});
