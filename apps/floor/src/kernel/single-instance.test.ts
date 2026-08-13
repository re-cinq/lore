import { describe, it, expect } from "vitest";
import { awaitSoleInstance, guardLockConnection } from "./single-instance.js";

/** Records what happened, so the tests assert the sequence rather than a mock. */
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

  it("waits for the holder to go, then proceeds", async () => {
    // A rolling update: the outgoing pod still holds the lock for a few seconds.
    // Exiting here would crash-loop the new pod against its own predecessor.
    const h = harness(3);

    await awaitSoleInstance(h.deps, { intervalMs: 500 });

    expect(h.attempts).toBe(3);
    expect(h.waits).toEqual([500, 500]);
  });

  it("says once that it is waiting, not once per tick", async () => {
    // This message is the whole point of the guard — it must be findable in a log,
    // and it must not bury the rest of startup during a slow handover.
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
  // The lock lives on a client checked out of the pool and never released. The
  // pool's own error handler covers IDLE clients only, so when Postgres restarted
  // (57P01 admin_shutdown) this client emitted an unhandled 'error' and took the
  // whole Floor down — seven times, until systemd's start limit gave up and left it
  // dead. A database blip must not be a permanent outage.
  it("reports the lost lock and exits, rather than dying on an unhandled event", async () => {
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
