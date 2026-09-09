import { describe, it, expect, vi, afterEach } from "vitest";
import { PassThrough } from "node:stream";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import { InMemoryAgentRunEvents } from "@re-cinq/lore-shared/project/agent-run-events/agent-run-events-memory.js";
import { InMemoryTaskEvents } from "@re-cinq/lore-shared/project/task-events/task-events-memory.js";
import { InMemoryRunNotifier } from "./run-notify-hub.js";
import {
  MAX_PENDING_NOTIFICATIONS,
  notifyFilterFor,
  prNumberOf,
  streamRun,
  type RunStreamDeps,
} from "./run-stream-session.js";

afterEach(() => {
  vi.useRealTimers();
});

const flush = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

function collect(stream: PassThrough): () => string {
  let out = "";

  stream.on("data", (chunk: Buffer) => {
    out += chunk.toString();
  });

  return () => out;
}

const eventNames = (text: string): string[] =>
  [...text.matchAll(/^event: (\S+)$/gm)].map((m) => m[1]);

const agentIds = (text: string): string[] =>
  [...text.matchAll(/^id: (\d+)$/gm)].map((m) => m[1]);

async function seedRun(over: { prNumber?: number | null } = {}) {
  const runs = new InMemoryAssemblyRuns();
  const args = over.prNumber === null ? {} : { pr_number: over.prNumber ?? 12 };
  const runId = await runs.start({
    blueprintName: "implementation",
    repo: "o/r",
    taskId: "task-1",
    args,
  });
  const events = new InMemoryAgentRunEvents();

  events.registerNode({
    agentCrName: "05fc5491-implement",
    assemblyLineId: runId,
    nodeId: "implement",
    iteration: 1,
  });
  const taskEvents = seedTaskEvents();
  const { nodeRowId } = await runs.ensureStationRun({
    assemblyRunId: runId,
    nodeId: "implement",
    iteration: 1,
    agentCrName: "05fc5491-implement",
  });
  const run = await runs.getById(runId);

  return { runs, run: run!, nodeRowId, events, taskEvents };
}

function seedTaskEvents(): InMemoryTaskEvents {
  const taskEvents = new InMemoryTaskEvents();

  taskEvents.record({
    taskId: "task-1",
    fromStatus: null,
    toStatus: "pending",
    metadata: null,
  });
  taskEvents.record({
    taskId: "task-1",
    fromStatus: "pending",
    toStatus: "running",
    metadata: null,
  });

  return taskEvents;
}

async function insertAgentEvents(
  events: InMemoryAgentRunEvents,
  count: number,
) {
  return events.insertBatch(
    Array.from({ length: count }, () => ({
      taskId: "task-1",
      agentCrName: "05fc5491-implement",
      eventType: "tool_call" as const,
    })),
  );
}

interface Opened {
  text: () => string;
  stream: PassThrough;
  notifier: InMemoryRunNotifier;
  ready: Promise<void>;
  teardown: () => void;
  prStatus: ReturnType<typeof vi.fn>;
}

function open(
  seed: Awaited<ReturnType<typeof seedRun>>,
  over: Partial<RunStreamDeps> = {},
): Opened {
  const stream = new PassThrough();
  const notifier = new InMemoryRunNotifier();
  const prStatus = vi.fn(async () => ({ computed_status: "open" }));
  const { ready, teardown } = streamRun(stream, {
    run: seed.run,
    after: "0",
    events: seed.events,
    runs: seed.runs,
    taskEvents: seed.taskEvents,
    prStatus,
    notifier,
    now: () => new Date("2026-09-09T10:00:00.000Z"),
    ...over,
  });

  return { text: collect(stream), stream, notifier, ready, teardown, prStatus };
}

describe("notifyFilterFor", () => {
  it("keys the subscription on the run, its task and its PR", async () => {
    const { run } = await seedRun();

    expect(notifyFilterFor(run)).toEqual({
      runId: run.id,
      taskId: "task-1",
      repo: "o/r",
      prNumber: 12,
    });
  });

  it("reads no PR from a run whose args carry none", async () => {
    const { run } = await seedRun({ prNumber: null });

    expect(prNumberOf(run)).toBeNull();
  });
});

describe("streamRun catch-up", () => {
  it("writes the run, every node, every task event and the CI check as a snapshot, then the agent replay, then catchup_complete", async () => {
    const seed = await seedRun();

    await insertAgentEvents(seed.events, 2);
    const opened = open(seed);

    await opened.ready;
    await flush();

    expect(eventNames(opened.text())).toEqual([
      "run_status",
      "node_status",
      "task_event",
      "task_event",
      "ci_check",
      "agent_event",
      "agent_event",
      "catchup_complete",
    ]);
    expect(agentIds(opened.text())).toEqual(["1", "2"]);
    expect(opened.text()).toContain('"last_id":"2"');
  });

  it("gives only agent events an id line, so the browser cursor never lands on a snapshot frame", async () => {
    const seed = await seedRun();

    await insertAgentEvents(seed.events, 1);
    const opened = open(seed);

    await opened.ready;

    const frames = opened.text().split("\n\n").filter(Boolean);
    const withId = frames.filter((frame) => frame.startsWith("id: "));

    expect(withId).toHaveLength(1);
    expect(withId[0]).toContain("event: agent_event");
  });

  it("pages the agent replay until a short page drains it", async () => {
    const seed = await seedRun();

    await insertAgentEvents(seed.events, 5);
    const listSince = vi.fn(seed.events.listSince.bind(seed.events));
    const opened = open(seed, { events: { listSince }, pageSize: 2 });

    await opened.ready;

    expect(agentIds(opened.text())).toEqual(["1", "2", "3", "4", "5"]);
    expect(listSince).toHaveBeenCalledTimes(3);
  });

  it("replays from the cursor the client supplied, scoped to this run", async () => {
    const seed = await seedRun();

    await insertAgentEvents(seed.events, 3);
    const opened = open(seed, { after: "2" });

    await opened.ready;

    expect(agentIds(opened.text())).toEqual(["3"]);
  });

  it("skips task events and the CI check for a task-less, PR-less run", async () => {
    const seed = await seedRun({ prNumber: null });
    const run = { ...seed.run, taskId: null };
    const opened = open({ ...seed, run });

    await opened.ready;

    expect(eventNames(opened.text())).toEqual([
      "run_status",
      "node_status",
      "catchup_complete",
    ]);
    expect(opened.prStatus).not.toHaveBeenCalled();
  });
});

describe("streamRun live tail", () => {
  it("re-reads and delivers agent rows written after catch-up on an agent_event notification", async () => {
    const seed = await seedRun();
    const opened = open(seed);

    await opened.ready;
    await insertAgentEvents(seed.events, 1);
    opened.notifier.publish({ kind: "agent_event", run: seed.run.id });
    await flush();

    expect(agentIds(opened.text())).toEqual(["1"]);
  });

  it("delivers the visit a node_status notification names, with its new outcome", async () => {
    const seed = await seedRun();
    const opened = open(seed);

    await opened.ready;
    await seed.runs.finishStationRunOnce(seed.nodeRowId, "success");
    opened.notifier.publish({
      kind: "node_status",
      run: seed.run.id,
      row: seed.nodeRowId,
    });
    await flush();

    const frames = opened.text().split("\n\n");
    const last = frames.filter((f) => f.includes("event: node_status")).at(-1);

    expect(last).toContain('"outcome":"success"');
  });

  it("delivers the run's new status on a run_status notification", async () => {
    const seed = await seedRun();
    const opened = open(seed);

    await opened.ready;
    await seed.runs.finish(seed.run.id, "success");
    opened.notifier.publish({ kind: "run_status", run: seed.run.id });
    await flush();

    expect(opened.text()).toContain('"status":"finished"');
  });

  it("delivers the one task event a task_event notification names", async () => {
    const seed = await seedRun();
    const opened = open(seed);

    await opened.ready;
    const added = seed.taskEvents.record({
      taskId: "task-1",
      fromStatus: "running",
      toStatus: "pr_created",
      metadata: null,
    });

    opened.notifier.publish({
      kind: "task_event",
      task: "task-1",
      id: added.id,
    });
    await flush();

    expect(
      eventNames(opened.text()).filter((n) => n === "task_event"),
    ).toHaveLength(3);
    expect(opened.text()).toContain('"to_status":"pr_created"');
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
    const opened = open(seed, { prStatus });

    await flush();
    release();
    await opened.ready;

    for (let i = 0; i < 3; i++) {
      opened.notifier.publish({ kind: "ci_check", repo: "o/r", pr: "12" });
    }
    await flush();
    release();
    await flush();

    expect(prStatus).toHaveBeenCalledTimes(2);
    expect(
      eventNames(opened.text()).filter((n) => n === "ci_check"),
    ).toHaveLength(2);
  });

  it("queues a notification that arrives during catch-up and handles it once live", async () => {
    const seed = await seedRun();
    const opened = open(seed);

    await insertAgentEvents(seed.events, 1);
    opened.notifier.publish({ kind: "agent_event", run: seed.run.id });
    await opened.ready;
    await flush();

    expect(agentIds(opened.text())).toEqual(["1"]);
    expect(
      eventNames(opened.text()).filter((n) => n === "agent_event"),
    ).toHaveLength(1);
  });

  it("re-sends the snapshot when the notifier resyncs after a lost connection", async () => {
    const seed = await seedRun();
    const opened = open(seed);

    await opened.ready;
    opened.notifier.resync();
    await flush();

    expect(
      eventNames(opened.text()).filter((n) => n === "run_status"),
    ).toHaveLength(2);
    expect(
      eventNames(opened.text()).filter((n) => n === "catchup_complete"),
    ).toHaveLength(2);
  });
});

describe("streamRun lifecycle", () => {
  it("writes a ping comment every 25 seconds", async () => {
    vi.useFakeTimers();
    const seed = await seedRun();
    const opened = open(seed, { heartbeatMs: 25_000 });

    await opened.ready;
    vi.advanceTimersByTime(25_000);

    expect(opened.text()).toContain(": ping\n\n");
  });

  it("unsubscribes and clears the heartbeat when the client disconnects", async () => {
    vi.useFakeTimers();
    const seed = await seedRun();
    const opened = open(seed, { heartbeatMs: 25_000 });

    await opened.ready;
    opened.teardown();
    vi.advanceTimersByTime(60_000);

    expect(opened.notifier.subscriberCount).toBe(0);
    expect(opened.text()).not.toContain(": ping");
  });

  it("ends the stream when buffered bytes exceed the high-water mark", async () => {
    const seed = await seedRun();
    const stream = new PassThrough();
    const notifier = new InMemoryRunNotifier();
    const { ready } = streamRun(stream, {
      run: seed.run,
      after: "0",
      events: seed.events,
      runs: seed.runs,
      taskEvents: seed.taskEvents,
      prStatus: async () => null,
      notifier,
      highWaterMark: 64,
    });

    await ready;

    expect(stream.writableEnded).toBe(true);
    expect(notifier.subscriberCount).toBe(0);
  });

  it("ends the stream when notifications queued during catch-up exceed the pending cap", async () => {
    const seed = await seedRun();
    const opened = open(seed);

    for (let i = 0; i <= MAX_PENDING_NOTIFICATIONS; i++) {
      opened.notifier.publish({ kind: "run_status", run: seed.run.id });
    }
    await opened.ready;

    expect(opened.stream.writableEnded).toBe(true);
    expect(opened.notifier.subscriberCount).toBe(0);
  });

  it("unsubscribes when the stream errors", async () => {
    const seed = await seedRun();
    const opened = open(seed);

    await opened.ready;
    opened.stream.emit("error", new Error("socket gone"));

    expect(opened.notifier.subscriberCount).toBe(0);
  });
});
