import { describe, it, expect } from "vitest";
import {
  TRANSCRIPT_CAP,
  initialRunState,
  reduceRunEvent,
  replayTo,
} from "./run-event-reducer";
import type { RunStreamEvent } from "./run-stream-types";
import type { AssemblyLineRunNode } from "./assembly-line-runs";
import { implementationDefinition } from "./builtin-definitions";

let nextId = 0;

function event(over: Partial<RunStreamEvent> = {}): RunStreamEvent {
  nextId += 1;

  return {
    id: String(nextId),
    taskId: "task-1",
    agentCrName: "abcd1234-implement",
    assemblyLineId: "line-1",
    nodeId: "implement",
    iteration: 1,
    eventType: "tool_call",
    toolName: "Edit",
    toolUseId: "toolu_1",
    isError: false,
    filePaths: [],
    summary: null,
    payload: {},
    createdAt: "2026-07-20T10:00:00.000Z",
    ...over,
  };
}

function visitRow(
  over: Partial<AssemblyLineRunNode> = {},
): AssemblyLineRunNode {
  return {
    nodeId: "implement",
    iteration: 1,
    outcome: null,
    agentCrName: null,
    commitSha: null,
    durationSeconds: null,
    ...over,
  };
}

describe("initialRunState", () => {
  it("seeds implement as succeeded and validate as running from visit rows", () => {
    const state = initialRunState(implementationDefinition, [
      visitRow({ nodeId: "implement", outcome: "success" }),
      visitRow({ nodeId: "validate", outcome: null }),
    ]);

    expect(state.nodeStates.implement).toMatchObject({ status: "succeeded" });
    expect(state.nodeStates.validate).toMatchObject({ status: "running" });
  });

  it("seeds a node with a failed outcome as failed", () => {
    const state = initialRunState(null, [
      visitRow({ outcome: "validate-failed" }),
    ]);

    expect(state.nodeStates.implement.status).toBe("failed");
  });

  it("seeds a changes_requested node as succeeded because the node finished", () => {
    const state = initialRunState(null, [
      visitRow({ outcome: "changes_requested" }),
    ]);

    expect(state.nodeStates.implement.status).toBe("succeeded");
  });

  it("seeds every definition node without a visit row as idle", () => {
    const state = initialRunState(implementationDefinition, []);

    expect(Object.keys(state.nodeStates).sort()).toEqual(
      implementationDefinition.nodes.map((n) => n.id).sort(),
    );
    expect(state.nodeStates.done).toEqual({
      status: "idle",
      iteration: 0,
      transcript: [],
      droppedCount: 0,
    });
  });

  it("keeps the highest iteration when a node has several visit rows", () => {
    const ascending = initialRunState(null, [
      visitRow({ iteration: 1, outcome: "failed" }),
      visitRow({ iteration: 2, outcome: null }),
    ]);
    const descending = initialRunState(null, [
      visitRow({ iteration: 2, outcome: null }),
      visitRow({ iteration: 1, outcome: "failed" }),
    ]);

    expect(ascending.nodeStates.implement).toMatchObject({
      status: "running",
      iteration: 2,
    });
    expect(descending.nodeStates.implement).toEqual(
      ascending.nodeStates.implement,
    );
  });

  it("returns an empty run state for a null definition and no visit rows", () => {
    expect(initialRunState(null, [])).toEqual({
      lastEventId: null,
      nodeStates: {},
      fileTouches: {},
      timeline: [],
    });
  });
});

describe("reduceRunEvent", () => {
  it("sets implement to running on an init event", () => {
    const state = reduceRunEvent(
      initialRunState(implementationDefinition, []),
      event({ eventType: "init" }),
    );

    expect(state.nodeStates.implement).toMatchObject({
      status: "running",
      iteration: 1,
    });
  });

  it("sets implement to succeeded on a result event without an error", () => {
    const state = replayTo(initialRunState(implementationDefinition, []), [
      event({ eventType: "init" }),
      event({ eventType: "result" }),
    ]);

    expect(state.nodeStates.implement.status).toBe("succeeded");
  });

  it("sets implement to failed on a result event with isError true", () => {
    const state = reduceRunEvent(
      initialRunState(implementationDefinition, []),
      event({ eventType: "result", isError: true }),
    );

    expect(state.nodeStates.implement.status).toBe("failed");
  });

  it("resets a failed implement to running on an iteration 2 init", () => {
    const failed = reduceRunEvent(
      initialRunState(implementationDefinition, []),
      event({ eventType: "result", isError: true }),
    );
    const retried = reduceRunEvent(
      failed,
      event({ eventType: "init", iteration: 2 }),
    );

    expect(retried.nodeStates.implement).toMatchObject({
      status: "running",
      iteration: 2,
    });
  });

  it("appends tool_call, tool_result and message entries to the node transcript", () => {
    const state = replayTo(initialRunState(implementationDefinition, []), [
      event({ eventType: "tool_call" }),
      event({ eventType: "tool_result" }),
      event({ eventType: "message" }),
    ]);

    expect(
      state.nodeStates.implement.transcript.map((e) => e.eventType),
    ).toEqual(["tool_call", "tool_result", "message"]);
  });

  it("creates a node state for an event whose node is absent from the definition", () => {
    const state = reduceRunEvent(
      initialRunState(null, []),
      event({ nodeId: "surprise", eventType: "init" }),
    );

    expect(state.nodeStates.surprise.status).toBe("running");
  });

  it("ignores an event that correlates to no node", () => {
    const before = initialRunState(implementationDefinition, []);
    const uncorrelated = event({ nodeId: null });
    const after = reduceRunEvent(before, uncorrelated);

    expect(after.nodeStates).toEqual(before.nodeStates);
    expect(after.lastEventId).toBe(uncorrelated.id);
  });

  it("exports TRANSCRIPT_CAP as 500", () => {
    expect(TRANSCRIPT_CAP).toBe(500);
  });

  it("leaves droppedCount at 0 for exactly 500 entries", () => {
    const events = Array.from({ length: TRANSCRIPT_CAP }, () => event());
    const state = replayTo(initialRunState(null, []), events);

    expect(state.nodeStates.implement.transcript).toHaveLength(TRANSCRIPT_CAP);
    expect(state.nodeStates.implement.droppedCount).toBe(0);
  });

  it("keeps the newest 500 transcript entries and marks the truncation", () => {
    const events = Array.from({ length: TRANSCRIPT_CAP + 3 }, (_, i) =>
      event({ summary: `entry-${i}` }),
    );
    const node = replayTo(initialRunState(null, []), events).nodeStates
      .implement;

    expect(node.transcript).toHaveLength(TRANSCRIPT_CAP);
    expect(node.droppedCount).toBe(3);
    expect(node.transcript[0].summary).toBe("entry-3");
    expect(node.transcript[TRANSCRIPT_CAP - 1].summary).toBe(
      `entry-${TRANSCRIPT_CAP + 2}`,
    );
  });

  it("returns the same state for an event id already applied", () => {
    const duplicate = event();
    const once = reduceRunEvent(initialRunState(null, []), duplicate);
    const twice = reduceRunEvent(once, duplicate);

    expect(twice).toBe(once);
  });

  it("returns the same state for an event behind the cursor", () => {
    const applied = reduceRunEvent(
      initialRunState(null, []),
      event({ id: "9" }),
    );
    const replayed = reduceRunEvent(applied, event({ id: "8" }));

    expect(replayed).toBe(applied);
  });

  it("orders ids by numeric value rather than lexicographically", () => {
    const applied = reduceRunEvent(
      initialRunState(null, []),
      event({ id: "9" }),
    );
    const later = reduceRunEvent(applied, event({ id: "10" }));

    expect(later.lastEventId).toBe("10");
    expect(later.nodeStates.implement.transcript).toHaveLength(2);
  });

  it("returns a new state object and leaves the input state unchanged", () => {
    const before = initialRunState(implementationDefinition, []);
    const snapshot = structuredClone(before.nodeStates);
    const after = reduceRunEvent(before, event());

    expect(after).not.toBe(before);
    expect(before.nodeStates).toEqual(snapshot);
    expect(before.nodeStates.implement.transcript).toHaveLength(0);
  });

  it("reuses the transcript array identity of every node the event does not touch", () => {
    const before = initialRunState(implementationDefinition, []);
    const after = reduceRunEvent(before, event({ nodeId: "implement" }));

    for (const node of implementationDefinition.nodes) {
      if (node.id === "implement") {
        continue;
      }

      expect(after.nodeStates[node.id]).toBe(before.nodeStates[node.id]);
    }
  });

  it("keeps the seeded iteration for an event that carries none", () => {
    const seeded = initialRunState(null, [visitRow({ iteration: 3 })]);
    const state = reduceRunEvent(seeded, event({ iteration: null }));

    expect(state.nodeStates.implement.iteration).toBe(3);
  });

  it("records filePaths from tool_call events as file touches", () => {
    const state = replayTo(initialRunState(null, []), [
      event({ filePaths: ["src/a.ts", "src/b.ts"] }),
      event({ filePaths: ["src/a.ts"] }),
    ]);

    expect(state.fileTouches).toEqual({ "src/a.ts": 2, "src/b.ts": 1 });
  });

  it("records only init and result events on the run timeline", () => {
    const state = replayTo(initialRunState(null, []), [
      event({ eventType: "init" }),
      event({ eventType: "tool_call" }),
      event({ eventType: "result" }),
    ]);

    expect(state.timeline.map((t) => t.eventType)).toEqual(["init", "result"]);
    expect(state.timeline[0]).toMatchObject({ nodeId: "implement" });
  });

  it("advances lastEventId to the id of the applied event", () => {
    const state = reduceRunEvent(
      initialRunState(null, []),
      event({ id: "99" }),
    );

    expect(state.lastEventId).toBe("99");
  });

  it("folds 5000 events in under 500ms", () => {
    const events = Array.from({ length: 5000 }, () => event());
    const started = performance.now();

    replayTo(initialRunState(implementationDefinition, []), events);

    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("replayTo", () => {
  it("with cursor 3 equals folding the first 3 events", () => {
    const base = initialRunState(implementationDefinition, []);
    const events = [
      event({ eventType: "init" }),
      event({ eventType: "tool_call" }),
      event({ eventType: "message" }),
      event({ eventType: "result" }),
    ];
    const folded = events
      .slice(0, 3)
      .reduce((state, ev) => reduceRunEvent(state, ev), base);

    expect(replayTo(base, events, 3)).toEqual(folded);
  });

  it("folds every event when no cursor is given", () => {
    const base = initialRunState(null, []);
    const events = [event(), event()];

    expect(replayTo(base, events).timeline).toEqual(
      replayTo(base, events, events.length).timeline,
    );
  });
});
