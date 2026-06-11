import { describe, it, expect } from "vitest";
import { connectedComponents, assignComponentCenters, settleTicks } from "./graph-layout";

describe("connectedComponents", () => {
  it("groups two disjoint link sets into two components", () => {
    const comps = connectedComponents(
      ["a", "b", "c", "d"],
      [
        { source: "a", target: "b" },
        { source: "c", target: "d" },
      ],
    );

    const sorted = comps.map((c) => [...c].sort()).sort((x, y) => x[0].localeCompare(y[0]));
    expect(sorted).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("collapses a chain of links into a single component", () => {
    const comps = connectedComponents(
      ["a", "b", "c"],
      [
        { source: "a", target: "b" },
        { source: "b", target: "c" },
      ],
    );

    expect(comps).toHaveLength(1);
    expect([...comps[0]].sort()).toEqual(["a", "b", "c"]);
  });

  it("returns a singleton component for a node with no links", () => {
    const comps = connectedComponents(["lonely"], []);

    expect(comps).toEqual([["lonely"]]);
  });
});

describe("assignComponentCenters", () => {
  const opts = { width: 1000, height: 800, smallThreshold: 10, edgeRadius: 300 };
  const center = { x: 500, y: 400 };
  const dist = (p: { x: number; y: number }) => Math.hypot(p.x - center.x, p.y - center.y);

  it("places every node of a large component (>= threshold) at the viewport centre", () => {
    const big = Array.from({ length: 12 }, (_, i) => `n${i}`);

    const centers = assignComponentCenters([big], opts);

    for (const id of big) {
      expect(centers.get(id)).toEqual(center);
    }
  });

  it("places small components on the edge ring at the configured radius", () => {
    const c1 = ["a", "b"];
    const c2 = ["c", "d"];

    const centers = assignComponentCenters([c1, c2], opts);

    expect(dist(centers.get("a")!)).toBeCloseTo(300);
    expect(dist(centers.get("c")!)).toBeCloseTo(300);
    // both nodes of a component share one center
    expect(centers.get("a")).toEqual(centers.get("b"));
  });

  it("spreads multiple small components to distinct angles on the ring", () => {
    const centers = assignComponentCenters([["a"], ["b"], ["c"]], opts);

    const pa = centers.get("a")!;
    const pb = centers.get("b")!;
    const pc = centers.get("c")!;
    expect(pa).not.toEqual(pb);
    expect(pb).not.toEqual(pc);
    expect(pa).not.toEqual(pc);
  });
});

describe("settleTicks", () => {
  it("floors the pre-warm at 120 ticks for a tiny graph", () => {
    expect(settleTicks(5)).toBe(120);
  });

  it("scales with node count between the floor and the cap", () => {
    expect(settleTicks(60)).toBe(180);
  });

  it("caps the pre-warm at 400 ticks for a huge graph", () => {
    expect(settleTicks(5000)).toBe(400);
  });
});
