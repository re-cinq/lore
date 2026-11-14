// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { LiveSocketClient } from "./live-socket/client";
import { FakeWebSocket } from "./live-socket/fake-web-socket";
import { liveFetch, setLiveClient, setSignInRedirect } from "./live-fetch";

function connectedClient(status: number, body: unknown) {
  const client = new LiveSocketClient({
    url: "ws://test/api/ws",
    socket: FakeWebSocket,
  });

  setLiveClient(client);
  const queue = () => {
    FakeWebSocket.latest.accept();
    FakeWebSocket.latest.receive({ type: "response", id: "r1", status, body });
  };

  return { queue };
}

beforeEach(() => {
  FakeWebSocket.reset();
  setLiveClient(null);
});

describe("liveFetch", () => {
  it("hands back the route's rows as a Response with status 200", async () => {
    const { queue } = connectedClient(200, { rows: [1, 2] });
    const response = liveFetch("/api/floor-runs?limit=2");

    queue();
    const answered = await response;

    expect({
      ok: answered.ok,
      status: answered.status,
      body: await answered.json(),
      sent: FakeWebSocket.latest.sent,
    }).toEqual({
      ok: true,
      status: 200,
      body: { rows: [1, 2] },
      sent: [
        {
          type: "request",
          id: "r1",
          method: "GET",
          path: "/api/floor-runs?limit=2",
        },
      ],
    });
  });

  it("sends the person to sign in on a 401", async () => {
    const { queue } = connectedClient(401, { error: "no session" });
    const redirects: string[] = [];

    setSignInRedirect((path) => redirects.push(path));
    const response = liveFetch("/api/floor-runs");

    queue();

    expect({
      status: (await response).status,
      redirects,
    }).toEqual({
      status: 401,
      redirects: [
        `/auth/signin?next=${encodeURIComponent(
          window.location.pathname + window.location.search,
        )}`,
      ],
    });
  });

  it("hands back a 403 untouched", async () => {
    const { queue } = connectedClient(403, { error: "forbidden" });
    const redirects: string[] = [];

    setSignInRedirect((path) => redirects.push(path));
    const response = liveFetch("/api/assembly-runs/r1/bag");

    queue();
    const answered = await response;

    expect({
      status: answered.status,
      body: await answered.json(),
      redirects,
    }).toEqual({ status: 403, body: { error: "forbidden" }, redirects: [] });
  });

  it("rejects when no socket is configured", async () => {
    await expect(liveFetch("/api/floor-runs")).rejects.toThrow(
      new Error("live socket unavailable"),
    );
  });

  it("sends the init body as JSON with its method", async () => {
    const { queue } = connectedClient(200, {});
    const response = liveFetch("/api/x", {
      method: "POST",
      body: { a: 1 },
    });

    queue();
    await response;

    expect(FakeWebSocket.latest.sent).toEqual([
      {
        type: "request",
        id: "r1",
        method: "POST",
        path: "/api/x",
        body: { a: 1 },
      },
    ]);
  });
});
