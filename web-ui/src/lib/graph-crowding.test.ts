import { describe, it, expect } from "vitest";
import {
  nodeDegrees,
  crowdedLinkStrength,
  crowdedCharge,
  crowdedCollideRadius,
} from "./graph-crowding";

describe("nodeDegrees", () => {
  it("counts both endpoints of a single link", () => {
    const deg = nodeDegrees([{ source: "a", target: "b" }]);

    expect(Object.fromEntries(deg)).toEqual({ a: 1, b: 1 });
  });

  it("sums a hub node that appears in several links", () => {
    const deg = nodeDegrees([
      { source: "hub", target: "x" },
      { source: "hub", target: "y" },
      { source: "z", target: "hub" },
    ]);

    expect(Object.fromEntries(deg)).toEqual({ hub: 3, x: 1, y: 1, z: 1 });
  });

  it("returns an empty map for no links", () => {
    expect(nodeDegrees([]).size).toBe(0);
  });
});

describe("crowdedLinkStrength", () => {
  it("returns the legacy 0.35 strength when the busier endpoint has degree 2", () => {
    expect(crowdedLinkStrength(2, 2)).toBeCloseTo(0.35);
  });

  it("keeps an isolated leaf-to-leaf link strong", () => {
    expect(crowdedLinkStrength(1, 1)).toBeCloseTo(0.7);
  });

  it("weakens by the busier (higher-degree) endpoint, not the quieter one", () => {
    expect(crowdedLinkStrength(1, 7)).toBeCloseTo(0.1);
  });

  it("clamps a link into a high-degree hub to the 0.04 floor", () => {
    expect(crowdedLinkStrength(1, 30)).toBeCloseTo(0.04);
  });
});

describe("crowdedCharge", () => {
  it("leaves a degree-1 node at its base charge", () => {
    expect(crowdedCharge(-520, 1)).toBeCloseTo(-520);
  });

  it("scales repulsion by the square root of degree", () => {
    expect(crowdedCharge(-520, 4)).toBeCloseTo(-1040);
  });

  it("caps the degree multiplier at sqrt(16) so a mega-hub cannot explode the layout", () => {
    expect(crowdedCharge(-520, 100)).toBeCloseTo(-2080);
  });
});

describe("crowdedCollideRadius", () => {
  it("reserves the circle plus 18px base padding for a degree-1 node", () => {
    expect(crowdedCollideRadius(12, 1)).toBe(31);
  });

  it("grows the reserved space as degree rises", () => {
    expect(crowdedCollideRadius(12, 5)).toBe(35);
  });

  it("caps the degree padding at 16px", () => {
    expect(crowdedCollideRadius(12, 40)).toBe(46);
  });
});
