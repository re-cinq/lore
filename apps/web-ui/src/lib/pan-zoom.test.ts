import { describe, expect, it } from "vitest";
import { fitView, panBy, zoomAt, ZOOM_MAX, ZOOM_MIN } from "./pan-zoom";

const NATURAL = { x: 0, y: 0, scale: 1 };

describe("zoomAt", () => {
  it("doubles the scale around point 100,50 and keeps that point under the pointer", () => {
    expect(zoomAt(NATURAL, 2, { x: 100, y: 50 })).toEqual({
      x: -100,
      y: -50,
      scale: 2,
    });
  });

  it("stops zooming in at the largest scale", () => {
    expect(
      zoomAt({ ...NATURAL, scale: ZOOM_MAX }, 2, { x: 0, y: 0 }).scale,
    ).toBe(ZOOM_MAX);
  });

  it("stops zooming out at the smallest scale", () => {
    expect(
      zoomAt({ ...NATURAL, scale: ZOOM_MIN }, 0.5, { x: 0, y: 0 }).scale,
    ).toBe(ZOOM_MIN);
  });
});

describe("panBy", () => {
  it("moves the view 30 right and 20 up", () => {
    expect(panBy(NATURAL, 30, -20)).toEqual({ x: 30, y: -20, scale: 1 });
  });
});

describe("fitView", () => {
  it("shrinks a 2000 wide diagram to a 1000 wide viewport at scale 0.5", () => {
    expect(fitView({ width: 2000, height: 300 }, 1000)).toEqual({
      x: 0,
      y: 0,
      scale: 0.5,
    });
  });

  it("keeps a 400 wide diagram at its own size in a 1000 wide viewport", () => {
    expect(fitView({ width: 400, height: 300 }, 1000)).toEqual(NATURAL);
  });
});
