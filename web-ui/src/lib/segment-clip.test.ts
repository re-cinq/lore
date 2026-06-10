import { describe, it, expect } from "vitest";
import { visibleSegments } from "./segment-clip";

describe("visibleSegments", () => {
  it("returns the whole segment when discs is empty", () => {
    const start = { x: 0, y: 0 };
    const end = { x: 10, y: 0 };

    expect(visibleSegments(start, end, [])).toEqual([{ a: start, b: end }]);
  });

  it("returns [] when the whole segment lies inside a disc", () => {
    const start = { x: -3, y: 0 };
    const end = { x: 3, y: 0 };
    const discs = [{ x: 0, y: 0, r: 10 }];

    expect(visibleSegments(start, end, discs)).toEqual([]);
  });

  it("returns the outside portion when only the start endpoint is inside a disc", () => {
    const start = { x: 0, y: 0 };
    const end = { x: 20, y: 0 };
    const discs = [{ x: 0, y: 0, r: 10 }];

    expect(visibleSegments(start, end, discs)).toEqual([
      { a: { x: 10, y: 0 }, b: { x: 20, y: 0 } },
    ]);
  });

  it("returns head and tail when a chord passes through a disc with both endpoints outside", () => {
    const start = { x: -20, y: 0 };
    const end = { x: 20, y: 0 };
    const discs = [{ x: 0, y: 0, r: 10 }];

    expect(visibleSegments(start, end, discs)).toEqual([
      { a: { x: -20, y: 0 }, b: { x: -10, y: 0 } },
      { a: { x: 10, y: 0 }, b: { x: 20, y: 0 } },
    ]);
  });

  it("returns three pieces when a segment crosses two separate discs", () => {
    const start = { x: -20, y: 0 };
    const end = { x: 60, y: 0 };
    const discs = [
      { x: 0, y: 0, r: 10 },
      { x: 40, y: 0, r: 10 },
    ];

    expect(visibleSegments(start, end, discs)).toEqual([
      { a: { x: -20, y: 0 }, b: { x: -10, y: 0 } },
      { a: { x: 10, y: 0 }, b: { x: 30, y: 0 } },
      { a: { x: 50, y: 0 }, b: { x: 60, y: 0 } },
    ]);
  });
});
