import { describe, it, expect } from "vitest";
import { startStationDrain } from "./loop-boot.js";
import type { StationDrainDeps } from "./loop-boot.js";

function deps(over: Partial<StationDrainDeps> = {}): StationDrainDeps {
  return {
    subscribe: async () => {},
    claim: async () => [],
    markDone: async () => {},
    markFailed: async () => {},
    markDead: async () => {},
    ...over,
  };
}

describe("startStationDrain", () => {
  it("registers its subscriptions BEFORE draining, since fan-out reads them at insert", async () => {
    const order: string[] = [];
    const timer = await startStationDrain(
      deps({
        subscribe: async () => {
          order.push("subscribe");
        },
        claim: async () => {
          order.push("claim");

          return [];
        },
      }),
      1,
    );

    await new Promise((r) => setTimeout(r, 20));
    clearInterval(timer);

    expect(order[0]).toBe("subscribe");
  });

  it("refuses to start when it cannot register, rather than draining nothing forever", async () => {
    await expect(
      startStationDrain(
        deps({
          subscribe: async () => {
            throw new Error("router unreachable");
          },
        }),
      ),
    ).rejects.toThrow("router unreachable");
  });

  it("subscribes under the one name the whole service shares", async () => {
    const seen: string[] = [];
    const timer = await startStationDrain(
      deps({
        subscribe: async (subscriber) => {
          seen.push(subscriber);
        },
      }),
      1000,
    );

    clearInterval(timer);
    expect(seen).toEqual(["stations"]);
  });
});
