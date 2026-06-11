import { describe, it, expect } from "vitest";
import { settleTicks, boundingRadius, radialContainmentDelta, radialTarget } from "./graph-layout";

describe("radialTarget", () => {
  const boundR = 1000;

  it("pulls Feature nodes to the centre", () => {
    expect(radialTarget("Feature", boundR).radius).toBe(0);
  });

  it("places Spec/Section/Statement/ADR on the middle ring", () => {
    for (const t of ["Spec", "Section", "Statement", "ADR"] as const) {
      expect(radialTarget(t, boundR).radius).toBeCloseTo(0.42 * boundR);
    }
  });

  it("places File/TestChunk/CodeChunk loose on the outer ring", () => {
    for (const t of ["File", "TestChunk", "CodeChunk"] as const) {
      expect(radialTarget(t, boundR).radius).toBeCloseTo(0.85 * boundR);
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

describe("radialContainmentDelta", () => {
  const center = { x: 0, y: 0 };

  it("applies no pull to a point inside the radius (soft border, not a wall)", () => {
    expect(radialContainmentDelta({ x: 10, y: 0 }, center, 100, 0.5)).toEqual({ dvx: 0, dvy: 0 });
  });

  it("pulls inward in proportion to how far the point overshoots the radius", () => {
    const d = radialContainmentDelta({ x: 200, y: 0 }, center, 100, 0.5);
    expect(d.dvx).toBeCloseTo(-50);
    expect(d.dvy).toBeCloseTo(0);
  });

  it("pulls a point farther out more strongly than one barely past the border", () => {
    const near = radialContainmentDelta({ x: 110, y: 0 }, center, 100, 0.5);
    const far = radialContainmentDelta({ x: 300, y: 0 }, center, 100, 0.5);
    expect(Math.abs(far.dvx)).toBeGreaterThan(Math.abs(near.dvx));
  });

  it("directs the pull along the inward radial for a diagonal point", () => {
    const d = radialContainmentDelta({ x: 30, y: 40 }, center, 25, 1);
    expect(d.dvx).toBeCloseTo(-15);
    expect(d.dvy).toBeCloseTo(-20);
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
