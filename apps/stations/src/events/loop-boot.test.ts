import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { describe, it, expect } from "vitest";
import { startStationDrain } from "./loop-boot.js";
import type { StationDrainDeps } from "./loop-boot.js";

function deps(over: Partial<StationDrainDeps> = {}): StationDrainDeps {
  return {
    subscribe: async () => {},
    reconcileDeliveries: async () => 0,
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
        1,
        new Map(),
        { attempts: 1, delayMs: 0 },
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

  it("retries a subscribe the router refused, since both boot at once", async () => {
    let attempts = 0;
    const timer = await startStationDrain(
      deps({
        subscribe: async () => {
          attempts++;

          enforceTrue(attempts >= 3, Error, "fetch failed");
        },
      }),
      1,
      new Map(),
      { attempts: 5, delayMs: 1 },
    );

    clearInterval(timer);
    expect(attempts).toBe(3);
  });

  it("gives up after the last attempt, so a drainer never claims an unregistered set", async () => {
    await expect(
      startStationDrain(
        deps({
          subscribe: async () => {
            throw new Error("fetch failed");
          },
        }),
        1,
        new Map(),
        { attempts: 2, delayMs: 1 },
      ),
    ).rejects.toThrow(/fetch failed/);
  });

  it("reconciles AFTER registering, so events published before it booted are picked up", async () => {
    const order: string[] = [];
    const timer = await startStationDrain(
      deps({
        subscribe: async () => {
          order.push("subscribe");
        },
        reconcileDeliveries: async () => {
          order.push("reconcile");

          return 2;
        },
      }),
      1,
      new Map(),
    );

    clearInterval(timer);
    expect(order).toEqual(["subscribe", "reconcile"]);
  });

  it("drains even when the reconcile fails, since it is a repair and not a precondition", async () => {
    const timer = await startStationDrain(
      deps({
        reconcileDeliveries: async () => {
          throw new Error("router blipped");
        },
      }),
      1,
      new Map(),
    );

    expect(timer).toBeDefined();
    clearInterval(timer);
  });
});
