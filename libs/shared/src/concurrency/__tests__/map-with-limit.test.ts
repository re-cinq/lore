import { describe, it, expect } from "vitest";
import { mapWithLimit } from "../map-with-limit.js";

describe("mapWithLimit", () => {
  it("never runs more than `limit` tasks at once", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await mapWithLimit(
      Array.from({ length: 10 }, (_, i) => i),
      2,
      async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
      },
    );
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it("returns results in input order regardless of completion order", async () => {
    const out = await mapWithLimit(
      [30, 10, 20],
      3,
      (ms) => new Promise<number>((r) => setTimeout(() => r(ms * 2), ms)),
    );
    expect(out).toEqual([60, 20, 40]);
  });
});
