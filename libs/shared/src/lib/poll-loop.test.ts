import { describe, it, expect } from "vitest";
import { backoffDelay, pollUntil, runPollLoop } from "./poll-loop.js";

type Outcome = "idle" | "hit" | "denied";

/** Drives the loop over a fixed script of outcomes, recording what it slept. */
function scriptedLoop(outcomes: Outcome[]) {
  const sleeps: number[] = [];
  const handled: Outcome[] = [];
  let tick = 0;

  return {
    sleeps,
    handled,
    run: (): Promise<void> =>
      runPollLoop<Outcome>({
        tick: () => Promise.resolve(outcomes[tick++]),
        onOutcome: (outcome) => {
          handled.push(outcome);
        },
        isIdle: (outcome) => outcome === "idle",
        delayFor: (outcome, idleTicks) =>
          outcome === "idle" ? backoffDelay(1000, idleTicks, 8000) : 1000,
        sleep: (ms) => {
          sleeps.push(ms);

          return Promise.resolve();
        },
        running: () => tick < outcomes.length,
      }),
  };
}

describe("backoffDelay", () => {
  it("returns the base delay at 0 attempts and doubles per attempt", () => {
    expect([0, 1, 2, 3].map((n) => backoffDelay(1000, n, 60_000))).toEqual([
      1000, 2000, 4000, 8000,
    ]);
  });

  it("caps at maxMs once doubling passes it", () => {
    expect(backoffDelay(1000, 10, 8000)).toBe(8000);
  });

  it("floors a negative attempt count at the base delay", () => {
    expect(backoffDelay(1000, -3, 8000)).toBe(1000);
  });
});

describe("runPollLoop", () => {
  it("holds the base delay on the first idle, doubles across consecutive idles, and resets after a hit", async () => {
    const loop = scriptedLoop(["idle", "idle", "idle", "hit", "idle"]);

    await loop.run();

    expect(loop.sleeps).toEqual([1000, 2000, 4000, 1000, 1000]);
  });

  it("caps the idle delay at the schedule's maximum", async () => {
    const loop = scriptedLoop(["idle", "idle", "idle", "idle", "idle"]);

    await loop.run();

    expect(loop.sleeps).toEqual([1000, 2000, 4000, 8000, 8000]);
  });

  it("keeps the base delay for a non-idle outcome that is not a hit either", async () => {
    const loop = scriptedLoop(["denied", "denied"]);

    await loop.run();

    expect(loop.sleeps).toEqual([1000, 1000]);
  });

  it("treats every outcome as non-idle when isIdle is omitted", async () => {
    const sleeps: number[] = [];
    let tick = 0;

    await runPollLoop<Outcome>({
      tick: () => Promise.resolve("idle"),
      delayFor: (_outcome, idleTicks) => backoffDelay(1000, idleTicks, 8000),
      sleep: (ms) => {
        sleeps.push(ms);

        return Promise.resolve();
      },
      running: () => tick++ < 3,
    });

    expect(sleeps).toEqual([1000, 1000, 1000]);
  });

  it("awaits onOutcome before the sleep that follows it", async () => {
    const order: string[] = [];
    let tick = 0;

    await runPollLoop<Outcome>({
      tick: () => Promise.resolve("hit"),
      onOutcome: async () => {
        order.push("handler-start");
        await Promise.resolve();
        order.push("handler-end");
      },
      delayFor: () => 1000,
      sleep: () => {
        order.push("sleep");

        return Promise.resolve();
      },
      running: () => tick++ < 1,
    });

    expect(order).toEqual(["handler-start", "handler-end", "sleep"]);
  });

  it("hands every outcome to onOutcome in order", async () => {
    const loop = scriptedLoop(["idle", "denied", "hit"]);

    await loop.run();

    expect(loop.handled).toEqual(["idle", "denied", "hit"]);
  });

  it("runs no tick at all when running() is false from the start", async () => {
    const loop = scriptedLoop([]);

    await loop.run();

    expect(loop.sleeps).toEqual([]);
    expect(loop.handled).toEqual([]);
  });
});

describe("pollUntil", () => {
  it("returns the first value without sleeping", async () => {
    const sleeps: number[] = [];
    const value = await pollUntil<string>({
      tick: () => Promise.resolve("ready"),
      baseDelayMs: 30_000,
      maxDelayMs: 300_000,
      sleep: (ms) => {
        sleeps.push(ms);

        return Promise.resolve();
      },
    });

    expect(value).toBe("ready");
    expect(sleeps).toEqual([]);
  });

  it("sleeps the doubling schedule up to the cap while tick returns null", async () => {
    const sleeps: number[] = [];
    let attempts = 0;
    const value = await pollUntil<string>({
      tick: () => Promise.resolve(++attempts < 7 ? null : "ready"),
      baseDelayMs: 30_000,
      maxDelayMs: 300_000,
      sleep: (ms) => {
        sleeps.push(ms);

        return Promise.resolve();
      },
    });

    expect(value).toBe("ready");
    expect(sleeps).toEqual([
      30_000, 60_000, 120_000, 240_000, 300_000, 300_000,
    ]);
  });
});
