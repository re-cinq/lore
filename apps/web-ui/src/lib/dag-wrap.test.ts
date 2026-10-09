import { describe, it, expect } from "vitest";
import { columnsFor, wrapLayer } from "./dag-wrap";

describe("wrapLayer", () => {
  it("puts layers 0..6 at 3 columns into bands 0,0,0,1,1,1,2", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((layer) => wrapLayer(layer, 3))).toEqual([
      { band: 0, column: 0 },
      { band: 0, column: 1 },
      { band: 0, column: 2 },
      { band: 1, column: 0 },
      { band: 1, column: 1 },
      { band: 1, column: 2 },
      { band: 2, column: 0 },
    ]);
  });

  it("keeps every layer in band 0 when the columns are unbounded", () => {
    expect(wrapLayer(40, Number.POSITIVE_INFINITY)).toEqual({
      band: 0,
      column: 40,
    });
  });
});

describe("columnsFor", () => {
  const pitch = { layerGap: 240, nodeWidth: 216, padding: 28 };

  it("fits 4 columns of 216px at a 240px pitch in 1000px", () => {
    expect(columnsFor(1000, pitch)).toBe(4);
  });

  it("never answers fewer than 1 column, even for a 200px panel", () => {
    expect(columnsFor(200, pitch)).toBe(1);
  });
});
