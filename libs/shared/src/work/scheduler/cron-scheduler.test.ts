import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createCronScheduler,
  registerCronEmitters,
  type SchedulerJobRuns,
  type TickEvent,
} from "./cron-scheduler.js";

const EVERY_MINUTE = "* * * * *";

function jobRunsThat(overrides: Partial<SchedulerJobRuns> = {}) {
  const calls: string[] = [];
  const jobRuns: SchedulerJobRuns = {
    lastRun: () => Promise.resolve(null),
    start: (jobName) => {
      calls.push(`start ${jobName}`);

      return Promise.resolve("run-1");
    },
    complete: (runId, summary) => {
      calls.push(`complete ${runId}: ${summary}`);

      return Promise.resolve();
    },
    fail: (runId, error) => {
      calls.push(`fail ${runId}: ${error}`);

      return Promise.resolve();
    },
    ...overrides,
  };

  return { jobRuns, calls };
}

function countingHandler(result: () => Promise<string>) {
  const ran = { times: 0 };

  return {
    ran,
    handler: () => {
      ran.times += 1;

      return result();
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("createCronScheduler", () => {
  it("completes the run with the handler result on success", async () => {
    const { jobRuns, calls } = jobRunsThat();
    const scheduler = createCronScheduler(jobRuns);

    scheduler.register("merge_check", EVERY_MINUTE, () =>
      Promise.resolve("emitted cron.merge_check.tick"),
    );
    await scheduler.start();

    expect(calls).toEqual([
      "start merge_check",
      "complete run-1: emitted cron.merge_check.tick",
    ]);
  });

  it("runs the job again on the next tick after starting its run rejects", async () => {
    let attempts = 0;
    const { jobRuns, calls } = jobRunsThat({
      start: () =>
        ++attempts === 1
          ? Promise.reject(new Error("connection refused"))
          : Promise.resolve("run-2"),
    });
    const { handler, ran } = countingHandler(() => Promise.resolve("done"));
    const scheduler = createCronScheduler(jobRuns);

    scheduler.register("merge_check", EVERY_MINUTE, handler);
    await scheduler.start();
    const ranAtStart = ran.times;

    await vi.advanceTimersByTimeAsync(30_000);

    expect({ ranAtStart, ranAfterTick: ran.times, calls }).toEqual({
      ranAtStart: 0,
      ranAfterTick: 1,
      calls: ["complete run-2: done"],
    });
  });

  it("records no failure when starting the run itself rejects, since there is no row to fail", async () => {
    const { jobRuns, calls } = jobRunsThat({
      start: () => Promise.reject(new Error("pool exhausted")),
    });
    const scheduler = createCronScheduler(jobRuns);

    scheduler.register("merge_check", EVERY_MINUTE, () =>
      Promise.resolve("done"),
    );
    await scheduler.start();

    expect(calls).toEqual([]);
  });

  it("fails the run with the handler's error and leaves the job due again", async () => {
    const { jobRuns, calls } = jobRunsThat();
    const { handler, ran } = countingHandler(() =>
      Promise.reject(new Error("boom")),
    );
    const scheduler = createCronScheduler(jobRuns);

    scheduler.register("merge_check", EVERY_MINUTE, handler);
    await scheduler.start();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(ran.times).toBe(2);
    expect(calls.slice(0, 2)).toEqual([
      "start merge_check",
      "fail run-1: boom",
    ]);
  });

  it("leaves a job alone whose last recorded run is after its latest cron slot, which is how two processes take turns", async () => {
    const { jobRuns, calls } = jobRunsThat({
      lastRun: () =>
        Promise.resolve({ startedAt: new Date(Date.now() + 1_000) } as never),
    });
    const scheduler = createCronScheduler(jobRuns);

    scheduler.register("merge_check", EVERY_MINUTE, () =>
      Promise.resolve("done"),
    );
    await scheduler.start();

    expect(calls).toEqual([]);
  });
});

describe("registerCronEmitters", () => {
  it("inserts cron.merge_check.tick keyed on its minute, so a tick two processes emit is one event", async () => {
    vi.setSystemTime(new Date("2026-10-02T08:15:42.000Z"));
    const inserted: TickEvent[] = [];
    const scheduler = createCronScheduler(jobRunsThat().jobRuns);

    registerCronEmitters(
      scheduler,
      [{ name: "merge_check", schedule: EVERY_MINUTE }],
      (event) => {
        inserted.push(event);

        return Promise.resolve();
      },
    );
    await scheduler.start();

    expect(inserted).toEqual([
      {
        eventName: "cron.merge_check.tick",
        source: "cron",
        dedupeKey: "cron:merge_check:2026-10-02T08:15Z",
      },
    ]);
  });
});
