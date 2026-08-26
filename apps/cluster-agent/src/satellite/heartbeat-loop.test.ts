import { describe, it, expect } from "vitest";
import {
  heartbeatIntervalMs,
  heartbeatOnce,
  runHeartbeatLoop,
} from "./heartbeat-loop.js";

const IDENTITY = { id: "agent-1", token: "lca_tok" };

function fakeFetch(status: number): {
  fetchImpl: typeof fetch;
  calls: Array<{ url: string; init: RequestInit }>;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];

  return {
    calls,
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });

      return new Response(status === 200 ? '{"status":"ok"}' : "{}", {
        status,
      });
    }) as typeof fetch,
  };
}

describe("heartbeatIntervalMs", () => {
  it("defaults to 30 seconds", () => {
    expect(heartbeatIntervalMs({})).toBe(30_000);
  });

  it("reads LORE_CLUSTER_AGENT_HEARTBEAT_S as seconds, ignoring garbage", () => {
    expect(heartbeatIntervalMs({ LORE_CLUSTER_AGENT_HEARTBEAT_S: "10" })).toBe(
      10_000,
    );
    expect(
      heartbeatIntervalMs({ LORE_CLUSTER_AGENT_HEARTBEAT_S: "soon" }),
    ).toBe(30_000);
  });
});

describe("heartbeatOnce", () => {
  it("posts the beat under the per-agent bearer token and reports ok on 200", async () => {
    const { fetchImpl, calls } = fakeFetch(200);

    expect(
      await heartbeatOnce({
        apiUrl: "https://lore-api.example",
        identity: () => IDENTITY,
        fetchImpl,
      }),
    ).toBe("ok");
    expect(calls[0]?.url).toBe(
      "https://lore-api.example/api/cluster-agents/agent-1/heartbeat",
    );
    expect(
      (calls[0]?.init.headers as Record<string, string>).authorization,
    ).toBe("Bearer lca_tok");
  });

  it("reports unauthorized on a 401 or 403 beat", async () => {
    for (const status of [401, 403]) {
      expect(
        await heartbeatOnce({
          apiUrl: "https://lore-api.example",
          identity: () => IDENTITY,
          fetchImpl: fakeFetch(status).fetchImpl,
        }),
      ).toBe("unauthorized");
    }
  });

  it("reports error, without throwing, on a 500 or a rejected fetch", async () => {
    const logs: string[] = [];

    expect(
      await heartbeatOnce({
        apiUrl: "https://lore-api.example",
        identity: () => IDENTITY,
        fetchImpl: fakeFetch(500).fetchImpl,
        log: (l) => logs.push(l),
      }),
    ).toBe("error");
    expect(
      await heartbeatOnce({
        apiUrl: "https://lore-api.example",
        identity: () => IDENTITY,
        fetchImpl: (async () => {
          throw new Error("network down");
        }) as typeof fetch,
        log: (l) => logs.push(l),
      }),
    ).toBe("error");
    expect(logs).toHaveLength(2);
  });
});

describe("runHeartbeatLoop", () => {
  it("beats at the fixed interval and re-registers on an unauthorized beat", async () => {
    const outcomes: Array<"ok" | "unauthorized" | "error"> = [
      "ok",
      "unauthorized",
      "error",
    ];
    const sleeps: number[] = [];
    let reRegistered = 0;
    let ticks = 0;

    await runHeartbeatLoop({
      beat: async () => outcomes[ticks++] ?? "ok",
      reRegister: async () => {
        reRegistered += 1;

        return null;
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      intervalMs: 30_000,
      running: () => ticks < 3,
    });

    expect(sleeps).toEqual([30_000, 30_000, 30_000]);
    expect(reRegistered).toBe(1);
  });
});
