import { describe, it, expect, vi } from "vitest";
import { RecordingSink } from "./frame-sink.js";
import { InMemoryRunNotifier } from "./run-notify-hub.js";
import {
  MAX_SUBSCRIBERS_PER_RUN,
  RunFeedRegistry,
  type RunFeedDeps,
} from "./run-feed.js";
import {
  insertAgentEvents,
  readDeps,
  seedRun,
  type Seed,
} from "./run-stream-session.test.js";

const flush = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

function registry(seed: Seed, over: Partial<RunFeedDeps> = {}) {
  const notifier = new InMemoryRunNotifier();
  const deps = { ...readDeps(seed), notifier, ...over };

  return { feeds: new RunFeedRegistry(deps), notifier, deps };
}

describe("RunFeedRegistry membership", () => {
  it("opens one feed and one hub subscription per run however many viewers join", async () => {
    const seed = await seedRun();
    const { feeds, notifier } = registry(seed);
    const first = feeds.join(seed.run, new RecordingSink(), "0");
    const second = feeds.join(seed.run, new RecordingSink(), "0");

    await Promise.all([first.ready, second.ready]);

    expect(feeds.feedCount).toBe(1);
    expect(feeds.subscriberCount(seed.run.id)).toBe(2);
    expect(notifier.subscriberCount).toBe(1);
  });

  it("closes the feed and unsubscribes when the last viewer leaves, and opens a fresh one for the next", async () => {
    const seed = await seedRun();
    const { feeds, notifier } = registry(seed);
    const first = feeds.join(seed.run, new RecordingSink(), "0");
    const second = feeds.join(seed.run, new RecordingSink(), "0");

    await Promise.all([first.ready, second.ready]);
    first.leave();
    const afterFirst = notifier.subscriberCount;

    second.leave();
    second.leave();
    const afterLast = { feeds: feeds.feedCount, hub: notifier.subscriberCount };

    await feeds.join(seed.run, new RecordingSink(), "0").ready;

    expect({ afterFirst, afterLast, fresh: feeds.feedCount }).toEqual({
      afterFirst: 1,
      afterLast: { feeds: 0, hub: 0 },
      fresh: 1,
    });
  });

  it("refuses a viewer past the per-run cap while keeping the others", async () => {
    const seed = await seedRun();
    const { feeds } = registry(seed);

    for (let i = 0; i < MAX_SUBSCRIBERS_PER_RUN; i++) {
      feeds.join(seed.run, new RecordingSink(), "0");
    }

    expect(() => feeds.join(seed.run, new RecordingSink(), "0")).toThrow(
      new Error(
        `run stream: ${seed.run.id} already has ${MAX_SUBSCRIBERS_PER_RUN} subscribers`,
      ),
    );
    expect(feeds.subscriberCount(seed.run.id)).toBe(MAX_SUBSCRIBERS_PER_RUN);
  });
});

describe("RunFeedRegistry catch-up", () => {
  it("gives a joining viewer its own snapshot and replay from its own cursor", async () => {
    const seed = await seedRun();

    await insertAgentEvents(seed.events, 3);
    const { feeds } = registry(seed);
    const early = new RecordingSink();
    const late = new RecordingSink();

    await feeds.join(seed.run, early, "0").ready;
    await feeds.join(seed.run, late, "2").ready;

    expect({
      early: early.agentIds,
      late: late.agentIds,
      lateSnapshots: late.types.filter((t) => t === "run_status").length,
      lateLast: late.frames.at(-1),
    }).toEqual({
      early: ["1", "2", "3"],
      late: ["3"],
      lateSnapshots: 1,
      lateLast: { type: "catchup_complete", last_id: "3" },
    });
  });

  it("does not replay to a late joiner the events the feed already forwarded live to it", async () => {
    const seed = await seedRun();
    const { feeds, notifier } = registry(seed);
    const viewer = new RecordingSink();

    await feeds.join(seed.run, viewer, "0").ready;
    await insertAgentEvents(seed.events, 2);
    notifier.publish({ kind: "agent_event", run: seed.run.id });
    await flush();
    notifier.resync();
    await flush();

    expect(viewer.agentIds).toEqual(["1", "2"]);
    expect(viewer.types.filter((t) => t === "catchup_complete")).toHaveLength(
      2,
    );
  });
});

describe("RunFeedRegistry live tail", () => {
  it("delivers no live frame to a viewer that joined while a live read was in flight, so its replay still covers every row once", async () => {
    const seed = await seedRun();
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const listSince = async (runId: string, after: string, limit: number) => {
      await held;

      return seed.events.listSince(runId, after, limit);
    };
    const { feeds, notifier } = registry(seed, { events: { listSince } });
    const early = new RecordingSink();
    const late = new RecordingSink();

    release();
    await feeds.join(seed.run, early, "0").ready;
    await insertAgentEvents(seed.events, 2);
    notifier.publish({ kind: "agent_event", run: seed.run.id });
    const joined = feeds.join(seed.run, late, "0");

    await flush();
    await joined.ready;

    expect({ early: early.agentIds, late: late.agentIds }).toEqual({
      early: ["1", "2"],
      late: ["1", "2"],
    });
  });

  it("re-reads a notification once and forwards the frame to every registered viewer", async () => {
    const seed = await seedRun();
    const listStationRuns = vi.fn(seed.runs.listStationRuns.bind(seed.runs));
    const { feeds, notifier } = registry(seed, {
      runs: { getById: seed.runs.getById.bind(seed.runs), listStationRuns },
    });
    const one = new RecordingSink();
    const two = new RecordingSink();

    await feeds.join(seed.run, one, "0").ready;
    await feeds.join(seed.run, two, "0").ready;
    listStationRuns.mockClear();
    await seed.runs.finishStationRunOnce(seed.nodeRowId, "success");
    notifier.publish({
      kind: "node_status",
      run: seed.run.id,
      row: seed.nodeRowId,
    });
    await flush();

    expect(listStationRuns).toHaveBeenCalledTimes(1);

    for (const sink of [one, two]) {
      expect(sink.frames.at(-1)).toMatchObject({
        type: "node_status",
        node: { outcome: "success" },
      });
    }
  });

  it("forwards transcript rows written after catch-up on an agent_event notification, from the feed's cursor", async () => {
    const seed = await seedRun();
    const listSince = vi.fn(seed.events.listSince.bind(seed.events));
    const { feeds, notifier } = registry(seed, { events: { listSince } });
    const one = new RecordingSink();
    const two = new RecordingSink();

    await feeds.join(seed.run, one, "0").ready;
    await feeds.join(seed.run, two, "0").ready;
    listSince.mockClear();
    await insertAgentEvents(seed.events, 2);
    notifier.publish({ kind: "agent_event", run: seed.run.id });
    await flush();

    expect(listSince).toHaveBeenCalledTimes(1);
    expect(one.agentIds).toEqual(["1", "2"]);
    expect(two.agentIds).toEqual(["1", "2"]);
  });

  it("forwards the run's new status and the one task event a notification names", async () => {
    const seed = await seedRun();
    const { feeds, notifier } = registry(seed);
    const viewer = new RecordingSink();

    await feeds.join(seed.run, viewer, "0").ready;
    await seed.runs.finish(seed.run.id, "success");
    notifier.publish({ kind: "run_status", run: seed.run.id });
    const added = seed.taskEvents.record({
      taskId: "task-1",
      fromStatus: "running",
      toStatus: "pr_created",
      metadata: null,
    });

    notifier.publish({ kind: "task_event", task: "task-1", id: added.id });
    await flush();

    expect(viewer.frames.slice(-2)).toMatchObject([
      { type: "run_status", run: { status: "finished" } },
      { type: "task_event", event: { to_status: "pr_created" } },
    ]);
  });

  it("reads GitHub once per burst of ci_check notifications", async () => {
    const seed = await seedRun();
    let release: () => void = () => {};
    const prStatus = vi.fn(
      () =>
        new Promise<Record<string, unknown>>((resolve) => {
          release = () => resolve({ computed_status: "open" });
        }),
    );
    const { feeds, notifier } = registry(seed, { prStatus });
    const viewer = new RecordingSink();
    const { ready } = feeds.join(seed.run, viewer, "0");

    await flush();
    release();
    await ready;

    for (let i = 0; i < 3; i++) {
      notifier.publish({ kind: "ci_check", repo: "o/r", pr: "12" });
    }
    await flush();
    release();
    await flush();

    expect(prStatus).toHaveBeenCalledTimes(2);
    expect(viewer.types.filter((t) => t === "ci_check")).toHaveLength(2);
  });

  it("handles a notification that arrives during a viewer's catch-up only after it", async () => {
    const seed = await seedRun();
    const { feeds, notifier } = registry(seed);
    const viewer = new RecordingSink();
    const { ready } = feeds.join(seed.run, viewer, "0");

    await insertAgentEvents(seed.events, 1);
    notifier.publish({ kind: "agent_event", run: seed.run.id });
    await ready;
    await flush();

    expect(viewer.agentIds).toEqual(["1"]);
    expect(viewer.types.indexOf("agent_event")).toBeLessThan(
      viewer.types.indexOf("catchup_complete"),
    );
  });

  it("re-sends every viewer's snapshot when the notifier resyncs after a lost connection", async () => {
    const seed = await seedRun();
    const { feeds, notifier } = registry(seed);
    const viewer = new RecordingSink();

    await feeds.join(seed.run, viewer, "0").ready;
    notifier.resync();
    await flush();

    expect(viewer.types.filter((t) => t === "run_status")).toHaveLength(2);
    expect(viewer.types.filter((t) => t === "catchup_complete")).toHaveLength(
      2,
    );
  });
});

describe("RunFeedRegistry dropping viewers", () => {
  it("ends a viewer that buffers past the high-water mark and keeps the others on the feed", async () => {
    const seed = await seedRun();
    const { feeds, notifier } = registry(seed, { highWaterMark: 64 });
    const slow = new RecordingSink(65);
    const fine = new RecordingSink();

    await feeds.join(seed.run, slow, "0").ready;
    await feeds.join(seed.run, fine, "0").ready;

    expect({
      slow: { ended: slow.ended, frames: slow.frames.length },
      fine: fine.ended,
      viewers: feeds.subscriberCount(seed.run.id),
      hub: notifier.subscriberCount,
    }).toEqual({
      slow: { ended: "slow", frames: 1 },
      fine: null,
      viewers: 1,
      hub: 1,
    });
  });

  it("ends every viewer with an error and closes the feed when a read fails", async () => {
    const seed = await seedRun();
    const { feeds, notifier } = registry(seed, {
      runs: {
        getById: async () => {
          throw new Error("db gone");
        },
        listStationRuns: seed.runs.listStationRuns.bind(seed.runs),
      },
    });
    const viewer = new RecordingSink();

    await feeds.join(seed.run, viewer, "0").ready;

    expect(viewer.ended).toBe("error");
    expect(feeds.feedCount).toBe(0);
    expect(notifier.subscriberCount).toBe(0);
  });
});
