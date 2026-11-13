import { describe, expect, it } from "vitest";
import { recordedPlanFloor } from "../../outbound/floor/recorded-plan-floor.js";
import { MAX_RUNS_PER_TICK, specUpkeepTick } from "./floor-spec-upkeep.js";

describe("spec upkeep throttling", () => {
  it("staggers PR creation with an explicit limit across repositories on an initial burst", async () => {
    const recorded = recordedPlanFloor();
    const summary = await specUpkeepTick(
      {},
      {
        floor: recorded.floor,
        repos: () =>
          Promise.resolve(
            Array.from({ length: 50 }, (_, i) => `acme/repo-${i}`),
          ),
        openPrBranches: () => Promise.resolve([]),
        now: () => new Date("2026-10-05T10:00:00Z"),
      },
    );

    expect(summary).toBe(
      `spec upkeep: started ${MAX_RUNS_PER_TICK}, skipped 0, failed 0`,
    );
  });
});
