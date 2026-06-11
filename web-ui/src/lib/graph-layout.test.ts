import { describe, it, expect } from "vitest";
import {
  connectedComponents,
  seedPositions,
  settleTicks,
  boundingRadius,
  containedVelocity,
  type SeedNode,
  type LayoutLink,
} from "./graph-layout";

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
    expect(connectedComponents(["lonely"], [])).toEqual([["lonely"]]);
  });
});

describe("seedPositions", () => {
  const width = 1000;
  const height = 800;
  const boundR = 600;
  const center = { x: 500, y: 400 };
  const dist = (p: { x: number; y: number }) => Math.hypot(p.x - center.x, p.y - center.y);

  // A 12-node hub-and-spoke core: 'hub' (degree 11) wired to 11 leaves.
  const star = (): { nodes: SeedNode[]; links: LayoutLink[] } => {
    const leaves = Array.from({ length: 11 }, (_, i) => `leaf${i}`);
    return {
      nodes: [{ id: "hub", degree: 11 }, ...leaves.map((id) => ({ id, degree: 1 }))],
      links: leaves.map((id) => ({ source: "hub", target: id })),
    };
  };

  it("seeds the most-connected node of the core at the viewport centre", () => {
    const { nodes, links } = star();

    const pos = seedPositions(nodes, links, { width, height, boundR });

    expect(pos.get("hub")).toEqual(center);
  });

  it("seeds lower-degree core nodes farther out than the hub", () => {
    const { nodes, links } = star();

    const pos = seedPositions(nodes, links, { width, height, boundR });

    expect(dist(pos.get("leaf0")!)).toBeGreaterThan(dist(pos.get("hub")!));
  });

  it("tucks a small disconnected component out on the outer margin", () => {
    const { nodes, links } = star();
    nodes.push({ id: "sa", degree: 1 }, { id: "sb", degree: 1 });
    links.push({ source: "sa", target: "sb" });

    const pos = seedPositions(nodes, links, { width, height, boundR });

    // Out near the margin, and the two satellites sit together.
    expect(dist(pos.get("sa")!)).toBeGreaterThan(boundR * 0.5);
    expect(Math.hypot(pos.get("sa")!.x - pos.get("sb")!.x, pos.get("sa")!.y - pos.get("sb")!.y)).toBeLessThan(40);
  });

  it("assigns a position to every node", () => {
    const { nodes, links } = star();
    nodes.push({ id: "sa", degree: 0 });

    const pos = seedPositions(nodes, links, { width, height, boundR });

    expect(pos.size).toBe(nodes.length);
  });
});

describe("boundingRadius", () => {
  it("floors a tiny graph at the minimum radius", () => {
    expect(boundingRadius(1, 0, { spacing: 40, floor: 260, cap: 2000 })).toBe(260);
  });

  it("scales with the square root of (vertices + edges)", () => {
    expect(boundingRadius(96, 4, { spacing: 40, floor: 0, cap: 1e9 })).toBeCloseTo(400);
  });

  it("caps a huge graph at the maximum radius", () => {
    expect(boundingRadius(100000, 0, { spacing: 40, floor: 260, cap: 1500 })).toBe(1500);
  });
});

describe("containedVelocity", () => {
  const center = { x: 0, y: 0 };
  const speed = (v: { vx: number; vy: number }) => Math.hypot(v.vx, v.vy);

  it("leaves the velocity of a node inside the radius unchanged", () => {
    expect(containedVelocity({ x: 10, y: 0 }, { vx: 5, vy: 0 }, center, 100)).toEqual({ vx: 5, vy: 0 });
  });

  it("zeroes a denormal-tiny velocity to avoid float jitter", () => {
    expect(containedVelocity({ x: 10, y: 0 }, { vx: 1e-9, vy: -1e-9 }, center, 100)).toEqual({ vx: 0, vy: 0 });
  });

  it("cancels the outward velocity of a node past the border (it cannot move further out)", () => {
    expect(containedVelocity({ x: 110, y: 0 }, { vx: 5, vy: 0 }, center, 100).vx).toBeLessThanOrEqual(0);
  });

  it("keeps an already-inward velocity heading inward when past the border", () => {
    expect(containedVelocity({ x: 110, y: 0 }, { vx: -5, vy: 0 }, center, 100).vx).toBeLessThan(0);
  });

  it("moves a node slower the further it has strayed past the border", () => {
    const near = containedVelocity({ x: 110, y: 0 }, { vx: 0, vy: 10 }, center, 100);
    const far = containedVelocity({ x: 600, y: 0 }, { vx: 0, vy: 10 }, center, 100);
    expect(speed(far)).toBeLessThan(speed(near));
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
