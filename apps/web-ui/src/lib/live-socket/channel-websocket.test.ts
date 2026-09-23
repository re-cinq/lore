// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { LiveSocketClient } from "./client";
import { channelWebSocketFor } from "./channel-websocket";
import { FakeWebSocket } from "./fake-web-socket";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function harness() {
  const client = new LiveSocketClient({
    url: "ws://test/api/ws",
    socket: FakeWebSocket,
    setTimer: () => 0,
    random: () => 0,
  });
  const Polyfill = channelWebSocketFor(client, "plan:o/r:1");
  const socket = new Polyfill("channel://plan");
  const events: string[] = [];

  socket.addEventListener("open", () => events.push("open"));
  socket.addEventListener("error", () => events.push("error"));
  socket.addEventListener("message", (event) =>
    events.push(
      `message:${Array.from(new Uint8Array((event as MessageEvent<ArrayBuffer>).data)).join(",")}`,
    ),
  );
  socket.addEventListener("close", (event) =>
    events.push(`close:${(event as unknown as { code: number }).code}`),
  );

  return { client, socket, events };
}

beforeEach(() => FakeWebSocket.reset());

describe("channelWebSocketFor", () => {
  it("opens a plan channel on the shared socket and reports open once the server says opened", async () => {
    const { socket, events } = harness();

    await FakeWebSocket.latest.acceptAndOpenAll();
    await flush();

    expect({
      readyState: socket.readyState,
      events,
      open: FakeWebSocket.latest.opens[0],
    }).toEqual({
      readyState: 1,
      events: ["open"],
      open: {
        type: "open",
        channel: "c1",
        kind: "plan",
        subject: "plan:o/r:1",
      },
    });
  });

  it("delivers tunnelled bytes as message events with an ArrayBuffer, and sends bytes as base64", async () => {
    const { socket, events } = harness();

    await FakeWebSocket.latest.acceptAndOpenAll();
    await flush();
    FakeWebSocket.latest.receive({ type: "data", channel: "c1", data: "AQI=" });
    socket.send(new Uint8Array([3, 4]));

    expect({ events, sent: FakeWebSocket.latest.sent.at(-1) }).toEqual({
      events: ["open", "message:1,2"],
      sent: { type: "send", channel: "c1", data: "AwQ=" },
    });
  });

  it("reads a lost socket as an error and an abnormal close, so Hocuspocus retries with a fresh instance", async () => {
    const { socket, events } = harness();

    await FakeWebSocket.latest.acceptAndOpenAll();
    await flush();
    FakeWebSocket.latest.drop();

    expect({ readyState: socket.readyState, events }).toEqual({
      readyState: 3,
      events: ["open", "error", "close:1006"],
    });
  });

  it("closes the channel on the wire once when Hocuspocus closes it", async () => {
    const { socket, events } = harness();

    await FakeWebSocket.latest.acceptAndOpenAll();
    await flush();
    socket.close();
    socket.close();

    expect({ events, sent: FakeWebSocket.latest.sent.slice(1) }).toEqual({
      events: ["open", "close:1000"],
      sent: [{ type: "close", channel: "c1" }],
    });
  });
});
