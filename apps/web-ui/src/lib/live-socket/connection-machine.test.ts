import { describe, it, expect } from "vitest";
import {
  INITIAL_STATE,
  reduce,
  type MachineEvent,
  type MachineState,
  type Transition,
} from "./connection-machine";

function run(
  events: MachineEvent[],
  from: MachineState = INITIAL_STATE,
): Transition {
  return events.reduce<Transition>(
    (last, event) => {
      const next = reduce(last.state, event);

      return { state: next.state, effects: [...last.effects, ...next.effects] };
    },
    { state: from, effects: [] },
  );
}

const openSocket = (): MachineState =>
  run([
    { type: "channel_requested", id: "a", kind: "run" },
    { type: "socket_open" },
  ]).state;

describe("connection machine — opening", () => {
  it("connects the socket for the first channel and opens the channel once the socket is up", () => {
    const first = reduce(INITIAL_STATE, {
      type: "channel_requested",
      id: "a",
      kind: "run",
    });
    const up = reduce(first.state, { type: "socket_open" });

    expect({ first, up }).toEqual({
      first: {
        state: {
          socket: "connecting",
          attempt: 0,
          channels: { a: { kind: "run", phase: "pending", attempt: 0 } },
        },
        effects: [
          { type: "notify", id: "a", state: "connecting" },
          { type: "connect" },
        ],
      },
      up: {
        state: {
          socket: "open",
          attempt: 0,
          channels: { a: { kind: "run", phase: "opening", attempt: 0 } },
        },
        effects: [{ type: "send_open", id: "a" }],
      },
    });
  });

  it("opens a channel requested on an open socket at once, and marks it live when the server says opened", () => {
    const requested = reduce(openSocket(), {
      type: "channel_requested",
      id: "b",
      kind: "plan",
    });
    const opened = reduce(requested.state, { type: "server_opened", id: "b" });

    expect({ requestedEffects: requested.effects, opened }).toEqual({
      requestedEffects: [
        { type: "notify", id: "b", state: "connecting" },
        { type: "send_open", id: "b" },
      ],
      opened: {
        state: {
          socket: "open",
          attempt: 0,
          channels: {
            a: { kind: "run", phase: "opening", attempt: 0 },
            b: { kind: "plan", phase: "open", attempt: 0 },
          },
        },
        effects: [{ type: "notify", id: "b", state: "live" }],
      },
    });
  });

  it("holds a channel requested while the socket is still connecting until it opens", () => {
    const { state, effects } = run([
      { type: "channel_requested", id: "a", kind: "run" },
      { type: "channel_requested", id: "b", kind: "plan" },
      { type: "socket_open" },
    ]);

    expect({
      socket: state.socket,
      opens: effects.filter((e) => e.type === "send_open"),
    }).toEqual({
      socket: "open",
      opens: [
        { type: "send_open", id: "a" },
        { type: "send_open", id: "b" },
      ],
    });
  });
});

describe("connection machine — releasing", () => {
  it("closes a released open channel on the wire and keeps the socket open with no channels", () => {
    const live = reduce(openSocket(), { type: "server_opened", id: "a" }).state;
    const released = reduce(live, { type: "channel_released", id: "a" });

    expect(released).toEqual({
      state: { socket: "open", attempt: 0, channels: {} },
      effects: [{ type: "send_close", id: "a" }],
    });
  });

  it("sends nothing for a released channel that never reached the wire", () => {
    const requested = reduce(INITIAL_STATE, {
      type: "channel_requested",
      id: "a",
      kind: "run",
    });

    expect(
      reduce(requested.state, { type: "channel_released", id: "a" }).effects,
    ).toEqual([]);
  });
});

describe("connection machine — the socket drops", () => {
  it("backs off, tells every channel it is reconnecting, and re-opens them all when the socket returns", () => {
    const live = reduce(openSocket(), { type: "server_opened", id: "a" }).state;
    const dropped = reduce(live, { type: "socket_closed" });
    const retried = reduce(dropped.state, { type: "retry_due" });
    const back = reduce(retried.state, { type: "socket_open" });

    expect({ dropped, retried: retried.effects, back }).toEqual({
      dropped: {
        state: {
          socket: "backoff",
          attempt: 1,
          channels: { a: { kind: "run", phase: "pending", attempt: 0 } },
        },
        effects: [
          { type: "notify", id: "a", state: "reconnecting" },
          { type: "schedule_retry", delayMs: 1000 },
        ],
      },
      retried: [{ type: "connect" }],
      back: {
        state: {
          socket: "open",
          attempt: 0,
          channels: { a: { kind: "run", phase: "opening", attempt: 0 } },
        },
        effects: [{ type: "send_open", id: "a" }],
      },
    });
  });

  it("goes idle rather than retrying when no channel is waiting", () => {
    const empty = reduce(openSocket(), {
      type: "channel_released",
      id: "a",
    }).state;

    expect(reduce(empty, { type: "socket_closed" })).toEqual({
      state: { socket: "idle", attempt: 0, channels: {} },
      effects: [],
    });
  });

  it("gives up after the sixth failure, telling every channel it is offline, and connects afresh for the next request", () => {
    let state = openSocket();

    for (let i = 0; i < 5; i++) {
      state = reduce(reduce(state, { type: "socket_closed" }).state, {
        type: "retry_due",
      }).state;
    }
    const gone = reduce(state, { type: "socket_closed" });
    const again = reduce(gone.state, {
      type: "channel_requested",
      id: "b",
      kind: "plan",
    });

    expect({
      gone,
      again: { socket: again.state.socket, effects: again.effects },
    }).toEqual({
      gone: {
        state: {
          socket: "gone",
          attempt: 6,
          channels: { a: { kind: "run", phase: "pending", attempt: 0 } },
        },
        effects: [{ type: "notify", id: "a", state: "offline" }],
      },
      again: {
        socket: "connecting",
        effects: [
          { type: "notify", id: "b", state: "connecting" },
          { type: "connect" },
        ],
      },
    });
  });
});

describe("connection machine — the server closes a channel", () => {
  it("ends a channel for good on unauthorized, not_found or client", () => {
    const live = reduce(openSocket(), { type: "server_opened", id: "a" }).state;

    expect(
      reduce(live, { type: "server_closed", id: "a", reason: "unauthorized" }),
    ).toEqual({
      state: {
        socket: "open",
        attempt: 0,
        channels: { a: { kind: "run", phase: "closed", attempt: 0 } },
      },
      effects: [{ type: "notify", id: "a", state: "offline" }],
    });
  });

  it("escalates the pause and gives up after five server closes, instead of re-opening forever", () => {
    const live = reduce(openSocket(), { type: "server_opened", id: "a" }).state;
    const delays: (number | "offline")[] = [];
    let state = live;

    for (let round = 0; round < 6; round += 1) {
      const closed = reduce(state, {
        type: "server_closed",
        id: "a",
        reason: "server",
      });

      delays.push(
        closed.effects.find((effect) => effect.type === "schedule_retry")
          ?.delayMs ?? "offline",
      );
      state = reduce(closed.state, { type: "retry_due" }).state;
    }

    expect({ delays, phase: state.channels.a?.phase }).toEqual({
      delays: [1000, 2000, 4000, 8000, 16000, "offline"],
      phase: "closed",
    });
  });

  it("forgets the failed attempts once the channel opens again", () => {
    const live = reduce(openSocket(), { type: "server_opened", id: "a" }).state;
    const closed = reduce(live, {
      type: "server_closed",
      id: "a",
      reason: "server",
    });
    const reopened = reduce(reduce(closed.state, { type: "retry_due" }).state, {
      type: "server_opened",
      id: "a",
    }).state;
    const closedAgain = reduce(reopened, {
      type: "server_closed",
      id: "a",
      reason: "server",
    });

    expect(
      closedAgain.effects.find((effect) => effect.type === "schedule_retry"),
    ).toEqual({ type: "schedule_retry", delayMs: 1000 });
  });

  it("re-opens a channel closed as slow after one second, and waits two when its token then fails", () => {
    const live = reduce(openSocket(), { type: "server_opened", id: "a" }).state;
    const slow = reduce(live, {
      type: "server_closed",
      id: "a",
      reason: "slow",
    });
    const retried = reduce(slow.state, { type: "retry_due" });
    const failed = reduce(retried.state, { type: "open_failed", id: "a" });

    expect({ slow, retried: retried.effects, failed: failed.effects }).toEqual({
      slow: {
        state: {
          socket: "open",
          attempt: 0,
          channels: { a: { kind: "run", phase: "pending", attempt: 1 } },
        },
        effects: [
          { type: "notify", id: "a", state: "reconnecting" },
          { type: "schedule_retry", delayMs: 1000 },
        ],
      },
      retried: [{ type: "send_open", id: "a" }],
      failed: [
        { type: "notify", id: "a", state: "reconnecting" },
        { type: "schedule_retry", delayMs: 2000 },
      ],
    });
  });

  it("ignores a server message about a channel it no longer holds", () => {
    expect(
      reduce(openSocket(), { type: "server_opened", id: "zzz" }).effects,
    ).toEqual([]);
  });
});
