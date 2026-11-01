import { describe, it, expect } from "vitest";
import { getSessionLog } from "@re-cinq/lore-server-core/platform/session-tracker.js";
import { trackLatency } from "./deps.js";

function lastCall() {
  return getSessionLog().at(-1);
}

describe("trackLatency", () => {
  it("returns the result 42 and records a successful call of lore_test_ok", async () => {
    const result = await trackLatency("lore_test_ok", async () => 42);

    expect({ result, call: lastCall() }).toMatchObject({
      result: 42,
      call: { tool: "lore_test_ok", success: true },
    });
  });

  it("rethrows the error and records a failed call of lore_test_fail", async () => {
    await expect(
      trackLatency("lore_test_fail", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow(new Error("boom"));

    expect(lastCall()).toMatchObject({
      tool: "lore_test_fail",
      success: false,
    });
  });
});
