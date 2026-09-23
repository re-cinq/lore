// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { LiveSocketClient } from "./client";
import { FakeWebSocket } from "./fake-web-socket";
import { planProvider } from "./plan-provider";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function connected() {
  const client = new LiveSocketClient({
    url: "ws://test/api/ws",
    socket: FakeWebSocket,
    setTimer: () => 0,
    random: () => 0,
  });

  return planProvider(client, "plan:o/r:1", async () => "tok");
}

const sentTypes = () => FakeWebSocket.latest.sent.map((m) => m.type);

beforeEach(() => FakeWebSocket.reset());

describe("planProvider", () => {
  it("sends the provider's auth message on the plan channel once the server opens it", async () => {
    const plan = connected();

    await FakeWebSocket.latest.acceptAndOpenAll();
    await flush();
    await flush();

    expect({
      first: sentTypes()[0],
      rest: new Set(sentTypes().slice(1)),
    }).toEqual({
      first: "open",
      rest: new Set(["send"]),
    });
    plan.destroy();
  });

  it("closes the channel on the wire when destroyed", async () => {
    const plan = connected();

    await FakeWebSocket.latest.acceptAndOpenAll();
    await flush();
    plan.destroy();
    await flush();

    expect(sentTypes().at(-1)).toBe("close");
  });
});
