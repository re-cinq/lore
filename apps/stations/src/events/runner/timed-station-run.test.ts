import { describe, expect, it } from "vitest";
import { timedStationRun } from "./timed-station-run.js";

describe("timedStationRun", () => {
  it("returns the summary of a run that resolves with 'swept 3'", async () => {
    expect(await timedStationRun("bus-prune", async () => "swept 3")).toEqual(
      "swept 3",
    );
  });

  it("rethrows the error of a run that fails with 'pool closed'", async () => {
    await expect(
      timedStationRun("bus-prune", async () => {
        throw new Error("pool closed");
      }),
    ).rejects.toThrow(new Error("pool closed"));
  });
});
