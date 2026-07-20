import { describe, it, expect, vi } from "vitest";
import type { AgentRunEventRow } from "@re-cinq/lore-shared";
import {
  AgentEventBus,
  MAX_BUFFERED_EVENTS,
  MAX_SUBSCRIBERS_PER_LINE,
  agentEventBus,
} from "./agent-event-bus.js";

const row = (assemblyLineId: string, id = "1"): AgentRunEventRow => ({
  id,
  taskId: "task-1",
  agentCrName: "cr-1",
  assemblyLineId,
  nodeId: "review",
  iteration: 1,
  eventType: "message",
  toolName: null,
  toolUseId: null,
  isError: false,
  filePaths: [],
  summary: null,
  payload: {},
  createdAt: new Date(0),
});

describe("AgentEventBus", () => {
  it("delivers a published row only to subscribers of its assemblyLineId", () => {
    const bus = new AgentEventBus();
    const mine = vi.fn();
    const theirs = vi.fn();

    bus.subscribe("line-a", mine);
    bus.subscribe("line-b", theirs);
    bus.publish([row("line-a")]);

    expect(mine).toHaveBeenCalledWith([row("line-a")]);
    expect(theirs).not.toHaveBeenCalled();
  });

  it("groups a mixed batch into one delivery per line", () => {
    const bus = new AgentEventBus();
    const handler = vi.fn();

    bus.subscribe("line-a", handler);
    bus.publish([row("line-a", "1"), row("line-b", "2"), row("line-a", "3")]);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toHaveLength(2);
  });

  it("ignores rows with a null assemblyLineId", () => {
    const bus = new AgentEventBus();
    const handler = vi.fn();

    bus.subscribe("line-a", handler);
    bus.publish([{ ...row("line-a"), assemblyLineId: null }]);

    expect(handler).not.toHaveBeenCalled();
  });

  it("does nothing when no subscriber exists for the line", () => {
    const bus = new AgentEventBus();

    expect(() => bus.publish([row("line-a")])).not.toThrow();
  });

  it("stops delivery after unsubscribe", () => {
    const bus = new AgentEventBus();
    const handler = vi.fn();
    const unsubscribe = bus.subscribe("line-a", handler);

    unsubscribe();
    bus.publish([row("line-a")]);

    expect(handler).not.toHaveBeenCalled();
  });

  it("keeps delivering to the other subscribers of a line after one unsubscribes", () => {
    const bus = new AgentEventBus();
    const survivor = vi.fn();
    const unsubscribe = bus.subscribe("line-a", vi.fn());

    bus.subscribe("line-a", survivor);
    unsubscribe();
    bus.publish([row("line-a")]);

    expect(survivor).toHaveBeenCalledTimes(1);
  });

  it("tolerates a second unsubscribe call", () => {
    const bus = new AgentEventBus();
    const unsubscribe = bus.subscribe("line-a", vi.fn());

    unsubscribe();

    expect(() => unsubscribe()).not.toThrow();
  });

  it("rejects a subscriber past the per-line cap", () => {
    const bus = new AgentEventBus();

    for (let i = 0; i < MAX_SUBSCRIBERS_PER_LINE; i++) {
      bus.subscribe("line-a", vi.fn());
    }

    expect(() => bus.subscribe("line-a", vi.fn())).toThrow(
      new Error(
        `agent event bus: line-a already has ${MAX_SUBSCRIBERS_PER_LINE} subscribers`,
      ),
    );
  });

  it("keeps delivering to the remaining subscribers when one throws", () => {
    const bus = new AgentEventBus();
    const survivor = vi.fn();

    bus.subscribe("line-a", () => {
      throw new Error("stalled client");
    });
    bus.subscribe("line-a", survivor);
    bus.publish([row("line-a")]);

    expect(survivor).toHaveBeenCalledTimes(1);
  });

  it("drops a subscriber whose undelivered events exceed the buffer bound", () => {
    const bus = new AgentEventBus();
    const onOverflow = vi.fn();
    const seen: string[] = [];
    let reentered = false;

    bus.subscribe(
      "line-a",
      (rows) => {
        seen.push(rows[0].id);

        if (reentered) {
          return;
        }
        reentered = true;

        for (let i = 0; i <= MAX_BUFFERED_EVENTS; i++) {
          bus.publish([row("line-a", `q${i}`)]);
        }
      },
      onOverflow,
    );
    bus.publish([row("line-a", "first")]);

    expect(onOverflow).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(1);
  });

  it("delivers nothing more to a subscriber the bus dropped for overflow", () => {
    const bus = new AgentEventBus();
    const handler = vi.fn((): void => {
      for (let i = 0; i <= MAX_BUFFERED_EVENTS; i++) {
        bus.publish([row("line-a", `q${i}`)]);
      }
    });

    bus.subscribe("line-a", handler);
    bus.publish([row("line-a", "first")]);
    handler.mockClear();
    bus.publish([row("line-a", "later")]);

    expect(handler).not.toHaveBeenCalled();
  });

  it("tolerates an overflow handler that throws", () => {
    const bus = new AgentEventBus();

    bus.subscribe(
      "line-a",
      () => {
        for (let i = 0; i <= MAX_BUFFERED_EVENTS; i++) {
          bus.publish([row("line-a", `q${i}`)]);
        }
      },
      () => {
        throw new Error("close failed");
      },
    );

    expect(() => bus.publish([row("line-a", "first")])).not.toThrow();
  });
});

describe("agentEventBus", () => {
  it("returns the same instance on every call", () => {
    expect(agentEventBus()).toBe(agentEventBus());
  });
});
