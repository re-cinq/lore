import { describe, it, expect, beforeEach } from "vitest";
import { LiveSocketClient } from "./client";
import { FakeWebSocket } from "./fake-web-socket";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function harness() {
  const timers: { fn: () => void; delayMs: number }[] = [];
  const client = new LiveSocketClient({
    url: "ws://test/api/ws",
    socket: FakeWebSocket,
    setTimer: (fn, delayMs) => timers.push({ fn, delayMs }),
    random: () => 0,
  });
  const fire = (delayMs: number) =>
    timers.find((timer) => timer.delayMs === delayMs)?.fn();

  return { client, timers, fire };
}

const settled = (promise: Promise<unknown>) =>
  promise.then(
    (value) => ({ value }),
    (error: Error) => ({ error: error.message }),
  );

beforeEach(() => FakeWebSocket.reset());

describe("LiveSocketClient requests", () => {
  it("resolves a GET with the response that carries its id", async () => {
    const { client } = harness();
    const answer = client.request("GET", "/api/floor-runs");

    FakeWebSocket.latest.accept();
    FakeWebSocket.latest.receive({
      type: "response",
      id: "r1",
      status: 200,
      body: { rows: [] },
    });

    expect(await answer).toEqual({ status: 200, body: { rows: [] } });
  });

  it("sends a request made before the socket opened once it opens", async () => {
    const { client } = harness();

    void client.request("POST", "/api/assembly-runs/r1/cancel", { a: 1 });
    const before = FakeWebSocket.latest.sent.length;

    FakeWebSocket.latest.accept();

    expect({ before, after: FakeWebSocket.latest.sent }).toEqual({
      before: 0,
      after: [
        {
          type: "request",
          id: "r1",
          method: "POST",
          path: "/api/assembly-runs/r1/cancel",
          body: { a: 1 },
        },
      ],
    });
  });

  it("sends a pending GET again after a reconnect", async () => {
    const { client, timers } = harness();
    const answer = client.request("GET", "/api/floor-runs");

    FakeWebSocket.latest.accept();
    FakeWebSocket.latest.drop();
    timers.find((timer) => timer.delayMs === 1000)?.fn();
    FakeWebSocket.latest.accept();
    FakeWebSocket.latest.receive({
      type: "response",
      id: "r1",
      status: 200,
      body: "ok",
    });

    expect({
      sockets: FakeWebSocket.instances.length,
      resent: FakeWebSocket.latest.sent.map((message) => message.type),
      answer: await answer,
    }).toEqual({
      sockets: 2,
      resent: ["request"],
      answer: { status: 200, body: "ok" },
    });
  });

  it("rejects a pending POST when the socket drops", async () => {
    const { client } = harness();
    const answer = settled(client.request("POST", "/api/x/cancel"));

    FakeWebSocket.latest.accept();
    FakeWebSocket.latest.drop();

    expect(await answer).toEqual({ error: "connection lost" });
  });

  it("rejects a request unanswered for 30 s", async () => {
    const { client, fire } = harness();
    const answer = settled(client.request("GET", "/api/floor-runs"));

    FakeWebSocket.latest.accept();
    await flush();
    fire(30_000);

    expect(await answer).toEqual({ error: "timed out" });
  });
});
