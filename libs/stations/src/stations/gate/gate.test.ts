import { describe, it, expect } from "vitest";
import { runGateStation } from "./gate.js";
import type { StationInput } from "@re-cinq/lore-shared/station-input.js";

const input = (over: Partial<StationInput> = {}): StationInput => ({
  assembly_run_id: "al-1",
  node_id: "n",
  node_type: "gate",
  repo: "o/r",
  branch: "lore/x",
  task_id: "t-1",
  params: {},
  ...over,
});

describe("runGateStation", () => {
  it("returns success and echoes the condition_ref", async () => {
    expect(
      await runGateStation(
        input({ params: { condition_ref: "auto_merge_eligible" } }),
      ),
    ).toEqual({
      outcome: "success",
      extras: { "Lore-Gate": "auto_merge_eligible" },
    });
    expect((await runGateStation(input())).extras).toEqual({
      "Lore-Gate": "none",
    });
  });
});
