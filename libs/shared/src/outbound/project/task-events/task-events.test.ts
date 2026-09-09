import { describe, it, expect } from "vitest";
import { InMemoryTaskEvents } from "./task-events-memory.js";

describe("InMemoryTaskEvents", () => {
  it("lists a task's events in the order they were recorded, with string ids", async () => {
    const events = new InMemoryTaskEvents();

    events.record({
      taskId: "task-1",
      fromStatus: null,
      toStatus: "pending",
      metadata: null,
    });
    events.record({
      taskId: "task-1",
      fromStatus: "pending",
      toStatus: "running",
      metadata: { agentId: "a" },
    });

    expect(await events.listForTask("task-1")).toMatchObject([
      { id: "1", fromStatus: null, toStatus: "pending" },
      { id: "2", fromStatus: "pending", toStatus: "running" },
    ]);
  });

  it("returns nothing for a task with no events, and never another task's rows", async () => {
    const events = new InMemoryTaskEvents();

    events.record({
      taskId: "task-2",
      fromStatus: null,
      toStatus: "pending",
      metadata: null,
    });

    expect(await events.listForTask("task-1")).toEqual([]);
  });
});
