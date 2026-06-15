import { describe, it, expect } from "vitest";
import { resolveSpacing, type Anchor } from "./anchor-spacing";

describe("resolveSpacing", () => {
  it("returns self unchanged with no anchors and no rings", () => {
    const self: Anchor = { id: "a", x: 100, y: 50 };

    expect(resolveSpacing(self, [], [], 40)).toEqual({ x: 100, y: 50 });
  });

  it("pushes self to gap distance along the anchor direction when too close to one anchor", () => {
    const self: Anchor = { id: "a", x: 3, y: 4 };
    const anchors: Anchor[] = [{ id: "b", x: 0, y: 0 }];

    expect(resolveSpacing(self, anchors, [], 40)).toEqual({ x: 24, y: 32 });
  });

  it("returns self unchanged when the only anchor shares self's id", () => {
    const self: Anchor = { id: "a", x: 100, y: 50 };
    const anchors: Anchor[] = [{ id: "a", x: 100, y: 50 }];

    expect(resolveSpacing(self, anchors, [], 40)).toEqual({ x: 100, y: 50 });
  });
});
