import { describe, it, expect } from "vitest";
import {
  settleTicks,
  boundingRadius,
  containedVelocity,
  connectedComponents,
  rimTargets,
  featureSeedPositions,
  radialTree,
  separateSmallComponents,
  countCrossings,
  featureRingRadius,
} from "./graph-layout";

describe("featureSeedPositions", () => {
  const center = { x: 0, y: 0 };
  const dist = (p: { x: number; y: number }) =>
    Math.hypot(p.x - center.x, p.y - center.y);

  it("keeps every feature within the seed radius and at a distinct spot", () => {
    const pos = featureSeedPositions(
      [
        { id: "a", size: 1 },
        { id: "b", size: 1 },
        { id: "c", size: 1 },
      ],
      center,
      300,
    );

    for (const id of ["a", "b", "c"]) {
      expect(dist(pos.get(id)!)).toBeLessThanOrEqual(300);
    }
    expect(pos.get("a")).not.toEqual(pos.get("b"));
  });

  it("seeds a larger feature further from the centre than a small one in the same slot", () => {
    const small = featureSeedPositions(
      [
        { id: "a", size: 1 },
        { id: "b", size: 1 },
      ],
      center,
      100,
    );
    const big = featureSeedPositions(
      [
        { id: "a", size: 9 },
        { id: "b", size: 1 },
      ],
      center,
      100,
    );

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

    const sorted = comps
      .map((c) => [...c].sort())
      .sort((x, y) => x[0].localeCompare(y[0]));

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
  const dist = (p: { x: number; y: number }) =>
    Math.hypot(p.x - center.x, p.y - center.y);

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
    expect(boundingRadius(1, 0, { spacing: 40, floor: 260, cap: 2000 })).toBe(
      260,
    );
  });

  it("scales with the square root of (vertices + edges)", () => {
    expect(
      boundingRadius(96, 4, { spacing: 40, floor: 0, cap: 1e9 }),
    ).toBeCloseTo(400);
  });

  it("caps a huge graph at the maximum radius", () => {
    expect(
      boundingRadius(100000, 0, { spacing: 40, floor: 260, cap: 1500 }),
    ).toBe(1500);
  });
});

describe("containedVelocity", () => {
  const center = { x: 0, y: 0 };
  const speed = (v: { vx: number; vy: number }) => Math.hypot(v.vx, v.vy);

  it("leaves the velocity of a node inside the radius unchanged", () => {
    expect(
      containedVelocity(
        { x: 10, y: 0 },
        { vx: 5, vy: 0 },
        { center, radius: 100 },
      ),
    ).toEqual({ vx: 5, vy: 0 });
  });

  it("zeroes a denormal-tiny velocity to avoid float jitter", () => {
    expect(
      containedVelocity(
        { x: 10, y: 0 },
        { vx: 1e-9, vy: -1e-9 },
        { center, radius: 100 },
      ),
    ).toEqual({ vx: 0, vy: 0 });
  });

  it("cancels the outward velocity of a node past the border (it cannot move further out)", () => {
    expect(
      containedVelocity(
        { x: 110, y: 0 },
        { vx: 5, vy: 0 },
        { center, radius: 100 },
      ).vx,
    ).toBeLessThanOrEqual(0);
  });

  it("keeps an already-inward velocity heading inward when past the border", () => {
    expect(
      containedVelocity(
        { x: 110, y: 0 },
        { vx: -5, vy: 0 },
        { center, radius: 100 },
      ).vx,
    ).toBeLessThan(0);
  });

  it("moves a node slower the further it has strayed past the border", () => {
    const near = containedVelocity(
      { x: 110, y: 0 },
      { vx: 0, vy: 10 },
      { center, radius: 100 },
    );
    const far = containedVelocity(
      { x: 600, y: 0 },
      { vx: 0, vy: 10 },
      { center, radius: 100 },
    );

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

describe("radialTree", () => {
  const opts = { center: { x: 0, y: 0 }, ringGap: 100 };

  it("places the root at the centre", () => {
    expect(radialTree("r", new Map(), opts).get("r")).toEqual({ x: 0, y: 0 });
  });

  it("spreads two leaf children to opposite sides one ring out", () => {
    const pos = radialTree("r", new Map([["r", ["c1", "c2"]]]), opts);

    expect(pos.get("c1")?.x).toBeCloseTo(0);
    expect(pos.get("c1")?.y).toBeCloseTo(100);
    expect(pos.get("c2")?.x).toBeCloseTo(0);
    expect(pos.get("c2")?.y).toBeCloseTo(-100);
  });

  it("puts each child one ring further out than its parent", () => {
    const pos = radialTree(
      "r",
      new Map([
        ["r", ["a"]],
        ["a", ["b"]],
      ]),
      opts,
    );

    expect(Math.hypot(pos.get("a")?.x ?? 0, pos.get("a")?.y ?? 0)).toBeCloseTo(
      100,
    );
    expect(Math.hypot(pos.get("b")?.x ?? 0, pos.get("b")?.y ?? 0)).toBeCloseTo(
      200,
    );
  });

  it("centres a parent at the mean angle of its children", () => {
    const pos = radialTree(
      "r",
      new Map([
        ["r", ["mid"]],
        ["mid", ["l1", "l2"]],
      ]),
      opts,
    );

    expect(pos.get("mid")?.x).toBeCloseTo(-100);
    expect(pos.get("mid")?.y).toBeCloseTo(0);
  });
});

describe("separateSmallComponents", () => {
  it("pushes every small component at least the margin away from any existing node", () => {
    const center = { x: 0, y: 0 };
    const margin = 300;
    const nodes = [
      { id: "m1", x: 0, y: 0 },
      { id: "m2", x: 50, y: 0 },
      { id: "m3", x: 0, y: -40 },
      { id: "s1", x: 5, y: 5 },
      { id: "s2", x: -10, y: 0 },
    ];
    const smallIds = new Set(["s1", "s2"]);

    const moved = separateSmallComponents(nodes, smallIds, center, margin);
    const placed = nodes.map((n) => ({ ...n, ...(moved.get(n.id) ?? {}) }));
    const mainNodes = placed.filter((n) => !smallIds.has(n.id));
    const smallNodes = placed.filter((n) => smallIds.has(n.id));

    smallNodes.forEach((small) => {
      mainNodes.forEach((main) => {
        expect(
          Math.hypot(small.x - main.x, small.y - main.y),
        ).toBeGreaterThanOrEqual(margin);
      });
    });
  });
});

describe("featureRingRadius", () => {
  it("grows the ring so many trees don't overlap", () => {
    // 20 trees of radius 300 need a circle big enough to seat them ~2.2·r apart
    expect(featureRingRadius(20, 300, 660)).toBeCloseTo(
      (20 * 2.2 * 300) / (2 * Math.PI),
    );
  });

  it("falls back to the minimum radius for a few small trees", () => {
    expect(featureRingRadius(2, 100, 660)).toBe(660);
  });
});

describe("countCrossings", () => {
  const pos = new Map([
    ["a", { x: 0, y: 0 }],
    ["b", { x: 10, y: 10 }],
    ["c", { x: 0, y: 10 }],
    ["d", { x: 10, y: 0 }],
  ]);

  it("counts one crossing for an X", () => {
    expect(
      countCrossings(
        [
          { source: "a", target: "b" },
          { source: "c", target: "d" },
        ],
        pos,
      ),
    ).toBe(1);
  });

  it("counts zero for parallel non-crossing edges", () => {
    const p = new Map([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 10, y: 0 }],
      ["c", { x: 0, y: 5 }],
      ["d", { x: 10, y: 5 }],
    ]);

    expect(
      countCrossings(
        [
          { source: "a", target: "b" },
          { source: "c", target: "d" },
        ],
        p,
      ),
    ).toBe(0);
  });

  it("ignores edges that share a node (they meet, not cross)", () => {
    expect(
      countCrossings(
        [
          { source: "a", target: "b" },
          { source: "a", target: "d" },
        ],
        pos,
      ),
    ).toBe(0);
  });

  it("sums crossings across several edges", () => {
    // a-b and c-d cross; e-f sits apart and crosses neither.
    const p = new Map([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 10, y: 10 }],
      ["c", { x: 0, y: 10 }],
      ["d", { x: 10, y: 0 }],
      ["e", { x: 100, y: 0 }],
      ["f", { x: 110, y: 0 }],
    ]);

    expect(
      countCrossings(
        [
          { source: "a", target: "b" },
          { source: "c", target: "d" },
          { source: "e", target: "f" },
        ],
        p,
      ),
    ).toBe(1);
  });
});
