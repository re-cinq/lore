import { describe, it, expect } from "vitest";
import {
  settleTicks,
  boundingRadius,
  containedVelocity,
  radialTarget,
  degreeAnchoredStrength,
} from "./graph-layout";

describe("radialTarget", () => {
  const boundR = 1000;

  it("pulls Feature nodes to the centre", () => {
    expect(radialTarget("Feature", boundR).radius).toBe(0);
  });

  it("places Spec/Section/Statement/ADR on the middle ring", () => {
    for (const t of ["Spec", "Section", "Statement", "ADR"] as const) {
      expect(radialTarget(t, boundR).radius).toBeCloseTo(0.36 * boundR);
    }
  });

  it("places File/TestChunk/CodeChunk loose on the outer ring", () => {
    for (const t of ["File", "TestChunk", "CodeChunk"] as const) {
      expect(radialTarget(t, boundR).radius).toBeCloseTo(0.68 * boundR);
    }
  });

  it("attracts the centre tier more strongly than the loose outer tier", () => {
    expect(radialTarget("Feature", boundR).strength).toBeGreaterThan(radialTarget("File", boundR).strength);
  });

  it("falls back to the loose outer tier for an unknown node type", () => {
    // The live projection can emit a type outside the declared union; never throw.
    expect(radialTarget("Mystery" as never, boundR)).toEqual(radialTarget("File", boundR));
  });
});

describe("degreeAnchoredStrength", () => {
  it("leaves a low-degree node at its base radial strength", () => {
    expect(degreeAnchoredStrength(0.12, 1, { cap: 16, max: 0.9 })).toBeCloseTo(0.12);
  });

  it("pulls a high-degree hub up to the max anchor strength so it can't fly out", () => {
    expect(degreeAnchoredStrength(0.12, 16, { cap: 16, max: 0.9 })).toBeCloseTo(0.9);
  });

  it("caps the anchor at the max for a degree beyond the cap", () => {
    expect(degreeAnchoredStrength(0.12, 100, { cap: 16, max: 0.9 })).toBeCloseTo(0.9);
  });

  it("anchors a busier node more firmly than a quieter one", () => {
    expect(degreeAnchoredStrength(0.12, 8, { cap: 16, max: 0.9 })).toBeGreaterThan(
      degreeAnchoredStrength(0.12, 3, { cap: 16, max: 0.9 }),
    );
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
    const v = containedVelocity({ x: 110, y: 0 }, { vx: 5, vy: 0 }, center, 100);
    expect(v.vx).toBeLessThanOrEqual(0);
  });

  it("keeps an already-inward velocity heading inward when past the border", () => {
    const v = containedVelocity({ x: 110, y: 0 }, { vx: -5, vy: 0 }, center, 100);
    expect(v.vx).toBeLessThan(0);
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
