import { describe, it, expect, vi } from "vitest";
import { runPollLoop, pollUntil } from "./backoff.js";

describe("runPollLoop", () => {
  it("ticks while running() holds, awaits onOutcome before the sleep that follows it, and sleeps whatever delayFor(outcome, idleTicks) returns — where idleTicks counts the consecutive isIdle outcomes BEFORE this one, so the first idle tick still sleeps the base delay and only consecutive ones grow it", async () => {
    const outcomes = ["busy", "idle", "idle", "busy", "idle"];
    let ticksCount = 0;
    const running = vi.fn(() => ticksCount < outcomes.length);
    const tick = vi.fn(async () => {
      const outcome = outcomes[ticksCount];
      ticksCount++;
      return outcome;
    });
    const onOutcome = vi.fn(async (_outcome: string) => {});
    const delayFor = vi.fn((outcome: string, idleTicks: number) => {
      if (outcome === "busy") {
        return 100;
      }

      return 200 * Math.pow(2, idleTicks);
    });
    const isIdle = (outcome: string) => outcome === "idle";
    const sleep = vi.fn(async (_ms: number) => {});

    await runPollLoop({
      running,
      tick,
      onOutcome,
      delayFor,
      isIdle,
      sleep,
    });

    expect(tick).toHaveBeenCalledTimes(5);
    expect(onOutcome).toHaveBeenCalledTimes(5);

    expect(delayFor.mock.calls).toEqual([
      ["busy", 0],
      ["idle", 0],
      ["idle", 1],
      ["busy", 0],
      ["idle", 0],
    ]);

    expect(sleep.mock.calls.map((c) => c[0])).toEqual([
      100, 200, 400, 100, 200,
    ]);
  });

  it("Omitting isIdle makes every outcome non-idle, giving a flat interval", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    let ticksCount = 0;
    const delayFor = vi.fn(() => 50);

    await runPollLoop({
      running: () => ticksCount < 3,
      tick: async () => {
        ticksCount++;

        return "any";
      },
      delayFor,
      sleep,
    });

    expect(delayFor.mock.calls).toEqual([
      ["any", 0],
      ["any", 0],
      ["any", 0],
    ]);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([50, 50, 50]);
  });

  it("a running() that is false from the start runs no tick at all", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const tick = vi.fn(async () => "any");

    await runPollLoop({
      running: () => false,
      tick,
      delayFor: () => 10,
      sleep,
    });

    expect(tick).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("pollUntil", () => {
  it("returns the first non-null value tick yields without sleeping, and otherwise retries forever, sleeping the backoffDelay schedule from baseDelayMs up to maxDelayMs", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    let calls = 0;

    const result = await pollUntil(
      async () => {
        calls++;

        if (calls < 6) {
          return null;
        }

        return "done";
      },
      100,
      300,
      { sleep },
    );

    expect(result).toBe("done");
    expect(calls).toBe(6);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([
      100, 200, 300, 300, 300,
    ]);
  });
});
