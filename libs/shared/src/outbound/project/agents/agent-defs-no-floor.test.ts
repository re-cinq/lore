import { describe, it, expect } from "vitest";
import { NO_FLOOR_DETAIL, NoFloorAgentDefs } from "./agent-defs-no-floor.js";

describe("NoFloorAgentDefs", () => {
  it("refuses to resolve loop-tdd, naming the floor as the only store", async () => {
    await expect(
      new NoFloorAgentDefs().resolve("re-cinq/lore", "loop-tdd"),
    ).rejects.toThrow(new Error(NO_FLOOR_DETAIL));
  });

  it("refuses to list re-cinq/lore's agents, naming the floor as the only store", async () => {
    await expect(new NoFloorAgentDefs().list("re-cinq/lore")).rejects.toThrow(
      new Error(NO_FLOOR_DETAIL),
    );
  });
});
