import { describe, it, expect, vi } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import { InMemoryAgentRunEvents } from "@re-cinq/lore-shared/project/agent-run-events/agent-run-events-memory.js";
import { InMemoryTaskEvents } from "@re-cinq/lore-shared/project/task-events/task-events-memory.js";
import { RecordingSink } from "./frame-sink.js";
import type { RunStreamFrame } from "./run-stream-frame.js";
import {
  catchUp,
  notifyFilterFor,
  prNumberOf,
  readNode,
  readTaskEvent,
  type RunReadDeps,
  type Subscriber,
} from "./run-stream-session.js";

export async function seedRun(over: { prNumber?: number | null } = {}) {
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

export async function insertAgentEvents(
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

export type Seed = Awaited<ReturnType<typeof seedRun>>;

export function readDeps(seed: Seed, over: Partial<RunReadDeps> = {}) {
  return {
    events: seed.events,
    runs: seed.runs,
    taskEvents: seed.taskEvents,
    prStatus: vi.fn(async () => ({ computed_status: "open" })),
    now: () => new Date("2026-09-09T10:00:00.000Z"),
    ...over,
  };
}

function subscriber(after = "0", sink = new RecordingSink()) {
  let cursor = after;
  let gone = false;
  const self: Subscriber & { sink: RecordingSink; close: () => void } = {
    sink,
    close: () => (gone = true),
    cursor: () => cursor,
    closed: () => gone,
    emit: (frame: RunStreamFrame) => {
      if (frame.type === "agent_event") {
        cursor = frame.event.id;
      }
      sink.send(frame);
    },
  };

  return self;
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

describe("catchUp", () => {
  it("delivers the run, every node, every task event and the CI check as a snapshot, then the agent replay, then catchup_complete", async () => {
    const seed = await seedRun();

    await insertAgentEvents(seed.events, 2);
    const viewer = subscriber();

    await catchUp(readDeps(seed), seed.run, viewer);

    expect(viewer.sink.types).toEqual([
      "run_status",
      "node_status",
      "task_event",
      "task_event",
      "ci_check",
      "agent_event",
      "agent_event",
      "catchup_complete",
    ]);
    expect(viewer.sink.agentIds).toEqual(["1", "2"]);
    expect(viewer.sink.frames.at(-1)).toEqual({
      type: "catchup_complete",
      last_id: "2",
    });
  });

  it("pages the agent replay until a short page drains it", async () => {
    const seed = await seedRun();

    await insertAgentEvents(seed.events, 5);
    const listSince = vi.fn(seed.events.listSince.bind(seed.events));
    const viewer = subscriber();

    await catchUp(
      readDeps(seed, { events: { listSince }, pageSize: 2 }),
      seed.run,
      viewer,
    );

    expect(viewer.sink.agentIds).toEqual(["1", "2", "3", "4", "5"]);
    expect(listSince).toHaveBeenCalledTimes(3);
  });

  it("replays from the cursor the viewer supplied, scoped to this run", async () => {
    const seed = await seedRun();

    await insertAgentEvents(seed.events, 3);
    const viewer = subscriber("2");

    await catchUp(readDeps(seed), seed.run, viewer);

    expect(viewer.sink.agentIds).toEqual(["3"]);
  });

  it("skips task events and the CI check for a task-less, PR-less run", async () => {
    const seed = await seedRun({ prNumber: null });
    const deps = readDeps(seed);
    const viewer = subscriber();

    await catchUp(deps, { ...seed.run, taskId: null }, viewer);

    expect(viewer.sink.types).toEqual([
      "run_status",
      "node_status",
      "catchup_complete",
    ]);
    expect(deps.prStatus).not.toHaveBeenCalled();
  });

  it("stops delivering once the viewer is gone, without a catchup_complete", async () => {
    const seed = await seedRun();

    await insertAgentEvents(seed.events, 1);
    const viewer = subscriber();

    viewer.close();
    await catchUp(readDeps(seed), seed.run, viewer);

    expect(viewer.sink.frames).toEqual([]);
  });
});

describe("live re-reads", () => {
  it("reads the visit a node_status notification names, with its new outcome", async () => {
    const seed = await seedRun();

    await seed.runs.finishStationRunOnce(seed.nodeRowId, "success");

    expect(await readNode(readDeps(seed), seed.run, seed.nodeRowId)).toMatchObject(
      { type: "node_status", node: { node_id: "implement", outcome: "success" } },
    );
  });

  it("reads nothing for a visit that is not there yet", async () => {
    const seed = await seedRun();

    expect(await readNode(readDeps(seed), seed.run, "nope")).toBeNull();
  });

  it("reads the one task event a task_event notification names, and nothing for a task-less run", async () => {
    const seed = await seedRun();
    const added = seed.taskEvents.record({
      taskId: "task-1",
      fromStatus: "running",
      toStatus: "pr_created",
      metadata: null,
    });

    expect(await readTaskEvent(readDeps(seed), seed.run, added.id)).toMatchObject(
      { type: "task_event", event: { to_status: "pr_created" } },
    );
    expect(
      await readTaskEvent(readDeps(seed), { ...seed.run, taskId: null }, added.id),
    ).toBeNull();
  });
});
