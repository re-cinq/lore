import { describe, it, expect, beforeEach, vi } from "vitest";
import { LiveSocketClient, type ChannelSpec } from "./client";
import { FakeWebSocket } from "./fake-web-socket";
import type { ChannelState } from "./connection-machine";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function harness() {
  const timers: { fn: () => void; delayMs: number }[] = [];
  const client = new LiveSocketClient({
    url: "ws://test/api/ws",
    socket: FakeWebSocket,
    setTimer: (fn, delayMs) => timers.push({ fn, delayMs }),
    random: () => 0,
  });
  const fireTimers = () => {
    for (const timer of timers.splice(0)) {
      timer.fn();
    }
  };

  return { client, timers, fireTimers };
}

function runSpec(over: Partial<ChannelSpec> = {}) {
  const states: ChannelState[] = [];
  const frames: unknown[] = [];

  return {
    states,
    frames,
    spec: {
      kind: "run" as const,
      subject: "run-1",
      token: async () => "tok",
      after: () => "7",
      onFrame: (frame: unknown) => frames.push(frame),
      onState: (state: ChannelState) => states.push(state),
      ...over,
    },
  };
}

beforeEach(() => FakeWebSocket.reset());

describe("LiveSocketClient", () => {
  it("opens the socket for the first channel and sends the run open with its token and cursor once the socket is up", async () => {
    const { client } = harness();
    const { spec, states } = runSpec();

    client.open(spec);
    FakeWebSocket.latest.accept();
    await flush();
    FakeWebSocket.latest.receive({ type: "opened", channel: "c1" });

    expect({ sent: FakeWebSocket.latest.sent, states }).toEqual({
      sent: [
        {
          type: "open",
          channel: "c1",
          kind: "run",
          subject: "run-1",
          token: "tok",
          after: "7",
        },
      ],
      states: ["connecting", "live"],
    });
  });

  it("delivers frames to the channel they name and tunnelled bytes to a plan channel", async () => {
    const { client } = harness();
    const { spec, frames } = runSpec();
    const received: Uint8Array[] = [];

    client.open(spec);
    client.open({
      kind: "plan",
      subject: "plan:o/r:1",
      onData: (bytes) => received.push(bytes),
    });
    await FakeWebSocket.latest.acceptAndOpenAll();
    await flush();
    FakeWebSocket.latest.receive({
      type: "frame",
      channel: "c1",
      frame: { type: "catchup_complete", last_id: "9" },
    });
    FakeWebSocket.latest.receive({ type: "data", channel: "c2", data: "AQI=" });

    expect({
      frames,
      received,
      opens: FakeWebSocket.latest.opens.map((o) => o.kind).sort(),
    }).toEqual({
      frames: [{ type: "catchup_complete", last_id: "9" }],
      received: [new Uint8Array([1, 2])],
      opens: ["plan", "run"],
    });
  });

  it("sends a plan channel's bytes as base64 only while the channel is open", async () => {
    const { client } = harness();
    const handle = client.open({ kind: "plan", subject: "plan:o/r:1" });

    handle.send(new Uint8Array([9]));
    await FakeWebSocket.latest.acceptAndOpenAll();
    await flush();
    handle.send(new Uint8Array([1, 2]));

    expect(FakeWebSocket.latest.sent.at(-1)).toEqual({
      type: "send",
      channel: "c1",
      data: "AQI=",
    });
  });

  it("closes a released channel on the wire and keeps the socket open for the next page", async () => {
    const { client } = harness();
    const handle = client.open(runSpec().spec);

    await FakeWebSocket.latest.acceptAndOpenAll();
    await flush();
    handle.close();
    const next = client.open(runSpec({ subject: "run-2" }).spec);

    await flush();

    expect({
      closed: FakeWebSocket.latest.closed,
      sent: FakeWebSocket.latest.sent.slice(1),
      sockets: FakeWebSocket.instances.length,
    }).toEqual({
      closed: false,
      sent: [
        { type: "close", channel: "c1" },
        {
          type: "open",
          channel: "c2",
          kind: "run",
          subject: "run-2",
          token: "tok",
          after: "7",
        },
      ],
      sockets: 1,
    });
    next.close();
  });

  it("reconnects after a drop with backoff, re-opening the channel from its newest cursor with a fresh token", async () => {
    const { client, timers, fireTimers } = harness();
    let cursor = "7";
    let tokens = 0;
    const { spec, states } = runSpec({
      after: () => cursor,
      token: async () => `tok${++tokens}`,
    });

    client.open(spec);
    await FakeWebSocket.latest.acceptAndOpenAll();
    await flush();
    cursor = "42";
    FakeWebSocket.latest.drop();
    const delayMs = timers[0]?.delayMs;

    fireTimers();
    FakeWebSocket.latest.accept();
    await flush();

    expect({
      delayMs,
      sockets: FakeWebSocket.instances.length,
      reopen: FakeWebSocket.latest.sent,
      states,
    }).toEqual({
      delayMs: 1000,
      sockets: 2,
      reopen: [
        {
          type: "open",
          channel: "c1",
          kind: "run",
          subject: "run-1",
          token: "tok2",
          after: "42",
        },
      ],
      states: ["connecting", "live", "reconnecting"],
    });
  });

  it("reports offline and stops when the server refuses the token, and retries when it could not be fetched", async () => {
    const { client, timers } = harness();
    const refused = runSpec();
    const failing = runSpec({
      subject: "run-2",
      token: vi.fn().mockRejectedValue(new Error("no session")),
    });

    client.open(refused.spec);
    client.open(failing.spec);
    FakeWebSocket.latest.accept();
    await flush();
    FakeWebSocket.latest.receive({
      type: "closed",
      channel: "c1",
      reason: "unauthorized",
    });

    expect({
      refused: refused.states,
      failing: failing.states,
      retries: timers.length,
    }).toEqual({
      refused: ["connecting", "offline"],
      failing: ["connecting", "reconnecting"],
      retries: 1,
    });
  });

  it("ignores events from a socket it has already replaced", async () => {
    const { client, fireTimers } = harness();

    client.open(runSpec().spec);
    const first = FakeWebSocket.latest;

    await first.acceptAndOpenAll();
    await flush();
    first.drop();
    fireTimers();
    const second = FakeWebSocket.latest;

    second.accept();
    first.drop();

    expect({
      phase: client.phase,
      sockets: FakeWebSocket.instances.length,
    }).toEqual({
      phase: "open",
      sockets: 2,
    });
  });
});
