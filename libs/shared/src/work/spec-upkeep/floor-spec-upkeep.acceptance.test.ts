import { describe, expect, it } from "vitest";
import { specUpkeepTick } from "./floor-spec-upkeep.js";
import type { UpkeepTickDeps } from "./floor-spec-upkeep.js";

describe("spec upkeep throttling", () => {
  it("staggers PR creation with an explicit limit across repositories on an initial burst", async () => {
    let started = 0;
    const deps: UpkeepTickDeps = {
      floor: {
        lines: {
          start: async () => {
            started++;

            return { id: "run-" + started };
          },
        },
      },
      repos: async () => Array.from({ length: 50 }, (_, i) => `acme/repo-${i}`),
      openPrBranches: async () => [],
      now: () => new Date("2026-10-05T10:00:00Z"),
    };

    await specUpkeepTick({}, deps);

    expect(started).toBeLessThan(50);
  });
});
