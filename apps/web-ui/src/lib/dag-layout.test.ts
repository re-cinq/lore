import { describe, it, expect } from "vitest";
import {
  layerByLongestPath,
  classifyEdges,
  layoutAssemblyLine,
} from "./dag-layout";
import {
  implementationDefinition,
  codeReviewDefinition,
  builtinDefinitions,
} from "./definition-fixtures";
import type { AssemblyLineDefinition } from "./assembly-line-definition";

const twoNodeLine: AssemblyLineDefinition = {
  name: "degenerate",
  description: "Two nodes, one edge.",
  version: 1,
  entry: "detect",
  exit: "done",
  nodes: [
    { id: "detect", type: "detect" },
    { id: "done", type: "retrospective" },
  ],
  edges: [{ from: "detect", to: "done", on: "success" }],
};

function kindOf(
  def: AssemblyLineDefinition,
  from: string,
  to: string,
): string | undefined {
  const layers = layerByLongestPath(def);

  return classifyEdges(def, layers).find((e) => e.from === from && e.to === to)
    ?.kind;
}

function yValuesOf(d: string): number[] {
  const numbers = d.match(/-?\d+(\.\d+)?/g) ?? [];

  return numbers.map(Number).filter((_, i) => i % 2 === 1);
}

describe("layerByLongestPath", () => {
  it("assigns layer 0 to implement and layer 5 to done for implementation", () => {
    const layers = layerByLongestPath(implementationDefinition);

    expect(Object.fromEntries(layers)).toEqual({
      implement: 0,
      validate: 1,
      push: 2,
      review: 3,
      address: 4,
      retrospective: 4,
      done: 5,
    });
  });

  it("ignores the implement-to-implement self-loop when assigning layers", () => {
    expect(layerByLongestPath(implementationDefinition).get("implement")).toBe(
      0,
    );
  });

  it("assigns layer 1 to the successor in a two-node line", () => {
    const layers = layerByLongestPath(twoNodeLine);

    expect(Object.fromEntries(layers)).toEqual({ detect: 0, done: 1 });
  });

  it("assigns layer 1 to every parallel-edge successor in code-review", () => {
    expect(
      Object.fromEntries(layerByLongestPath(codeReviewDefinition)),
    ).toEqual({ review: 0, done: 1 });
  });
});

describe("classifyEdges", () => {
  it("classifies implement-to-implement as self", () => {
    expect(kindOf(implementationDefinition, "implement", "implement")).toBe(
      "self",
    );
  });

  it("classifies validate-to-implement as back", () => {
    expect(kindOf(implementationDefinition, "validate", "implement")).toBe(
      "back",
    );
  });

  it("classifies address-to-validate as back", () => {
    expect(kindOf(implementationDefinition, "address", "validate")).toBe(
      "back",
    );
  });

  it("classifies implement-to-validate as forward", () => {
    expect(kindOf(implementationDefinition, "implement", "validate")).toBe(
      "forward",
    );
  });

  it("preserves the edge condition and iteration_max on the classified edge", () => {
    const layers = layerByLongestPath(implementationDefinition);
    const edge = classifyEdges(implementationDefinition, layers).find(
      (e) => e.from === "review" && e.to === "address",
    );

    expect(edge).toMatchObject({
      on: "changes_requested",
      iteration_max: 2,
      kind: "forward",
    });
  });
});

describe("layoutAssemblyLine", () => {
  it("returns a non-zero-length path for the implement self-loop", () => {
    const loop = layoutAssemblyLine(implementationDefinition).edges.find(
      (e) => e.kind === "self",
    );
    const points = loop?.d.match(/-?\d+(\.\d+)?/g) ?? [];

    expect(loop?.d).toContain("C");
    expect(new Set(points).size).toBeGreaterThan(2);
  });

  it("routes the validate-to-implement back-edge below the node row", () => {
    const layout = layoutAssemblyLine(implementationDefinition);
    const back = layout.edges.find(
      (e) => e.from === "validate" && e.to === "implement",
    );
    const lowestNode = Math.max(...layout.nodes.map((n) => n.y));

    expect(Math.max(...yValuesOf(back?.d ?? ""))).toBeGreaterThan(lowestNode);
  });

  it("keeps every forward-edge path within the node row", () => {
    const layout = layoutAssemblyLine(implementationDefinition);
    const lowestNode = Math.max(...layout.nodes.map((n) => n.y));

    for (const edge of layout.edges.filter((e) => e.kind === "forward")) {
      expect(Math.max(...yValuesOf(edge.d))).toBeLessThanOrEqual(lowestNode);
    }
  });

  it("returns identical output for two calls with the same definition", () => {
    expect(layoutAssemblyLine(implementationDefinition)).toEqual(
      layoutAssemblyLine(implementationDefinition),
    );
  });

  it("draws a lone forward edge level between the facing node ports", () => {
    const edge = layoutAssemblyLine(twoNodeLine).edges.find(
      (e) => e.kind === "forward",
    );

    expect(new Set(yValuesOf(edge?.d ?? "")).size).toBe(1);
  });

  it("places a node at x proportional to its layer", () => {
    const layout = layoutAssemblyLine(twoNodeLine, { layerGap: 100 });
    const positions = Object.fromEntries(layout.nodes.map((n) => [n.id, n.x]));

    expect(positions.done - positions.detect).toBe(100);
  });

  it("assigns every node of every builtin definition a distinct position", () => {
    for (const def of builtinDefinitions) {
      const layout = layoutAssemblyLine(def);
      const seen = new Set(layout.nodes.map((n) => `${n.x},${n.y}`));

      expect(seen.size).toBe(def.nodes.length);
      expect(layout.nodes.map((n) => n.id).sort()).toEqual(
        def.nodes.map((n) => n.id).sort(),
      );
    }
  });

  it("returns a canvas large enough to contain every node and back-edge arc", () => {
    const layout = layoutAssemblyLine(implementationDefinition);

    expect(layout.width).toBeGreaterThan(
      Math.max(...layout.nodes.map((n) => n.x)),
    );
    expect(layout.height).toBeGreaterThan(
      Math.max(...layout.nodes.map((n) => n.y)),
    );
  });

  it("lays out an unreachable node and empties the path of a dangling edge", () => {
    const malformed: AssemblyLineDefinition = {
      ...twoNodeLine,
      nodes: [...twoNodeLine.nodes, { id: "orphan", type: "validate" }],
      edges: [
        ...twoNodeLine.edges,
        { from: "orphan", to: "ghost", on: "always" },
        { from: "phantom", to: "done", on: "always" },
      ],
    };
    const layout = layoutAssemblyLine(malformed);

    expect(layout.nodes.map((n) => n.id)).toContain("orphan");
    expect(layout.edges.find((e) => e.to === "ghost")?.d).toBe("");
    expect(layout.edges.find((e) => e.from === "phantom")?.d).toBe("");
    expect(layerByLongestPath(malformed).get("done")).toBe(1);
  });

  it("emits one layout edge per definition edge", () => {
    for (const def of builtinDefinitions) {
      expect(layoutAssemblyLine(def).edges).toHaveLength(def.edges.length);
    }
  });

  it("returns a content box that contains every node box", () => {
    const layout = layoutAssemblyLine(implementationDefinition);
    const halfW = 132 / 2;
    const halfH = 48 / 2;

    for (const node of layout.nodes) {
      expect(layout.contentBox.minX).toBeLessThanOrEqual(node.x - halfW);
      expect(layout.contentBox.maxX).toBeGreaterThanOrEqual(node.x + halfW);
      expect(layout.contentBox.minY).toBeLessThanOrEqual(node.y - halfH);
      expect(layout.contentBox.maxY).toBeGreaterThanOrEqual(node.y + halfH);
    }
  });

  it("returns a content box tight to a single node rather than the layer grid", () => {
    const { contentBox } = layoutAssemblyLine(twoNodeLine);
    const spanX = contentBox.maxX - contentBox.minX;

    expect(spanX).toBeLessThan(layoutAssemblyLine(twoNodeLine).width);
    expect(spanX).toBeGreaterThan(0);
  });
});
