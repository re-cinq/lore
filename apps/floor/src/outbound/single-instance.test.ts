import { describe, it, expect } from "vitest";
import { awaitSoleInstance, guardLockConnection } from "./single-instance.js";

function harness(acquireOn: number) {
  const log: string[] = [];
  let attempts = 0;
  const waits: number[] = [];

  return {
    log,
    waits,
    get attempts() {
      return attempts;
    },
    deps: {
      tryAcquire: async () => {
        attempts += 1;

        return attempts >= acquireOn;
      },
      sleep: async (ms: number) => {
        waits.push(ms);
      },
      log: (message: string) => log.push(message),
    },
  };
}

describe("awaitSoleInstance", () => {
  it("starts immediately and says nothing when no other Floor holds the lock", async () => {
    const h = harness(1);

    await awaitSoleInstance(h.deps, { intervalMs: 500 });

    expect({ attempts: h.attempts, waits: h.waits, log: h.log }).toEqual({
      attempts: 1,
      waits: [],
      log: [],
    });
  });

  it("waits for a rolling update's outgoing pod to release the lock, then proceeds, rather than crash-looping against its predecessor", async () => {
    const h = harness(3);

    await awaitSoleInstance(h.deps, { intervalMs: 500 });

    expect(h.attempts).toBe(3);
    expect(h.waits).toEqual([500, 500]);
  });

  it("says once that it is waiting, not once per tick, so a slow handover doesn't bury startup logs", async () => {
    const h = harness(4);

    await awaitSoleInstance(h.deps, { intervalMs: 10 });

    expect(h.log.filter((l) => /another Floor/i.test(l))).toHaveLength(1);
  });

  it("reports when it took over, so a handover is visible after the fact", async () => {
    const h = harness(2);

    await awaitSoleInstance(h.deps, { intervalMs: 10 });

    expect(h.log[h.log.length - 1]).toMatch(/acquired|took over/i);
  });
});

describe("the lock connection dying", () => {
  it("reports the lost lock and exits on a Postgres restart (57P01 admin_shutdown), rather than an unhandled error crash-looping the Floor past systemd's start limit", async () => {
    const log: string[] = [];
    const exits: number[] = [];
    let onError: ((err: Error) => void) | undefined;
    const client = {
      on: (event: string, handler: (err: Error) => void) => {
        if (event === "error") {
          onError = handler;
        }
      },
    };

    guardLockConnection(client, {
      log: (m) => log.push(m),
      exit: (code) => exits.push(code),
    });

    expect(onError).toBeTypeOf("function");
    onError?.(new Error("terminating connection due to administrator command"));

    expect(exits).toEqual([1]);
    expect(log.join(" ")).toMatch(/lock|connection/i);
    expect(log.join(" ")).toContain("administrator command");
  });
});
