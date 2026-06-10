import { describe, it, expect } from "vitest";
import { resolveExclusion } from "./ring-exclusion";

describe("resolveExclusion", () => {
  it("returns the point unchanged when farther than r + margin from the disc", () => {
    const discs = [{ x: 0, y: 0, r: 10 }];
    expect(resolveExclusion({ x: 100, y: 0 }, discs, 4)).toEqual({ x: 100, y: 0 });
  });

  it("pushes an inside point at (3, 4) radially out to r + margin keeping direction", () => {
    const discs = [{ x: 0, y: 0, r: 10 }];
    expect(resolveExclusion({ x: 3, y: 4 }, discs, 4)).toEqual({ x: 8.4, y: 11.2 });
  });

  it("pushes a point exactly at the disc center out along positive x to r + margin", () => {
    const discs = [{ x: 0, y: 0, r: 10 }];
    expect(resolveExclusion({ x: 0, y: 0 }, discs, 4)).toEqual({ x: 14, y: 0 });
  });
});
