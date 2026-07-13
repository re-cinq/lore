import { describe, it, expect } from "vitest";
import { mergePersistentFeatures, type SpecGraph } from "./spec-graph.js";

const baseGraph: SpecGraph = {
  nodes: [
    {
      id: "u1",
      type: "Feature",
      label: "7-feature-planning",
      path: "specs/7-feature-planning",
    },
    {
      id: "u2",
      type: "Spec",
      label: "spec.md",
      path: "specs/7-feature-planning/spec.md",
    },
  ],
  links: [{ source: "u1", target: "u2", kind: "in_feature" }],
};

describe("mergePersistentFeatures", () => {
  it("enriches a computed Feature node sharing the path (persistent wins)", () => {
    const merged = mergePersistentFeatures(baseGraph, [
      {
        id: "f1",
        title: "Smart Feature Planning",
        path: "specs/7-feature-planning",
        status: "pr-open",
      },
    ]);
    const node = merged.nodes.find((n) => n.id === "u1");
    expect(node).toMatchObject({
      label: "Smart Feature Planning",
      status: "pr-open",
      featureId: "f1",
    });
  });

  it("injects a standalone node for a draft with no computed Feature", () => {
    const merged = mergePersistentFeatures(baseGraph, [
      {
        id: "f2",
        title: "Draft Idea",
        path: "specs/draft-idea",
        status: "draft",
      },
    ]);
    const injected = merged.nodes.find((n) => n.id === "feature:f2");
    expect(injected).toMatchObject({
      type: "Feature",
      label: "Draft Idea",
      path: "specs/draft-idea",
      status: "draft",
      featureId: "f2",
    });
  });

  it("leaves links untouched and does not duplicate matched features", () => {
    const merged = mergePersistentFeatures(baseGraph, [
      {
        id: "f1",
        title: "Smart Feature Planning",
        path: "specs/7-feature-planning",
        status: "implemented",
      },
    ]);
    expect(merged.links).toEqual(baseGraph.links);
    expect(merged.nodes.filter((n) => n.type === "Feature")).toHaveLength(1);
  });

  it("returns the graph unchanged when there are no persistent features", () => {
    const merged = mergePersistentFeatures(baseGraph, []);
    expect(merged.nodes).toHaveLength(2);
  });
});
