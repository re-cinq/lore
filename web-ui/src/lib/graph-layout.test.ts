import { describe, it, expect } from "vitest";
import {
  settleTicks,
  boundingRadius,
  containedVelocity,
  connectedComponents,
  rimTargets,
  featureSeedPositions,
} from "./graph-layout";

describe("featureSeedPositions", () => {
  const center = { x: 0, y: 0 };
  const dist = (p: { x: number; y: number }) => Math.hypot(p.x - center.x, p.y - center.y);

  it("keeps every feature within the seed radius and at a distinct spot", () => {
    const pos = featureSeedPositions(
      [{ id: "a", size: 1 }, { id: "b", size: 1 }, { id: "c", size: 1 }],
      center,
      300,
    );

    for (const id of ["a", "b", "c"]) expect(dist(pos.get(id)!)).toBeLessThanOrEqual(300);
    expect(pos.get("a")).not.toEqual(pos.get("b"));
  });

  it("seeds a larger feature further from the centre than a small one in the same slot", () => {
    const small = featureSeedPositions([{ id: "a", size: 1 }, { id: "b", size: 1 }], center, 100);
    const big = featureSeedPositions([{ id: "a", size: 9 }, { id: "b", size: 1 }], center, 100);

    expect(dist(big.get("a")!)).toBeGreaterThan(dist(small.get("a")!));
  });
});

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

  it("returns a singleton component for a node with no links", () => {
    expect(connectedComponents(["lonely"], [])).toEqual([["lonely"]]);
  });
});

describe("rimTargets", () => {
  const center = { x: 0, y: 0 };
  const dist = (p: { x: number; y: number }) => Math.hypot(p.x - center.x, p.y - center.y);

  it("places every component's spot on the rim at the given radius", () => {
    const targets = rimTargets([["a"], ["b"], ["c", "d"]], center, 100);

    expect(dist(targets.get("a")!)).toBeCloseTo(100);
    expect(dist(targets.get("c")!)).toBeCloseTo(100);
  });

  it("gives different components distinct spots but co-locates a component's own nodes", () => {
    const targets = rimTargets([["a"], ["b"], ["c", "d"]], center, 100);

    expect(targets.get("a")).not.toEqual(targets.get("b"));
    expect(targets.get("c")).toEqual(targets.get("d"));
  });

  it("returns an empty map for no components", () => {
    expect(rimTargets([], center, 100).size).toBe(0);
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
