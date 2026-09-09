import { describe, it, expect } from "vitest";
import { TelemetrySink } from "./telemetry-sink.js";

const NDJSON = '{"type":"result"}\n';
const message = { kind: "telemetry" as const, body: NDJSON };

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function fakeFetch(status: number): {
  fetchFn: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];

  return {
    calls,
    fetchFn: (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });

      return new Response(null, { status });
    }) as unknown as typeof fetch,
  };
}

describe("TelemetrySink", () => {
  it("posts the body verbatim to the Floor's sink with the cluster's credential", async () => {
    const { fetchFn, calls } = fakeFetch(202);

    await new TelemetrySink(
      "https://floor.example",
      () => "per-agent-token",
      fetchFn,
    ).deliver(message);

    expect({
      url: calls[0].url,
      auth: (calls[0].init?.headers as Record<string, string>).authorization,
      body: calls[0].init?.body,
    }).toEqual({
      url: "https://floor.example/api/agent-events",
      auth: "Bearer per-agent-token",
      body: NDJSON,
    });
  });

  it("resolves the token per call, so a re-registration's rotation is picked up", async () => {
    const { fetchFn, calls } = fakeFetch(202);
    let current = "first";
    const sink = new TelemetrySink(
      "https://floor.example",
      () => current,
      fetchFn,
    );

    await sink.deliver(message);
    current = "rotated";
    await sink.deliver(message);

    expect(
      calls.map(
        (call) => (call.init?.headers as Record<string, string>).authorization,
      ),
    ).toEqual(["Bearer first", "Bearer rotated"]);
  });

  it("posts with no authorization header before this cluster has registered, so the 401 drives a re-registration", async () => {
    const { fetchFn, calls } = fakeFetch(401);

    await expect(
      new TelemetrySink(
        "https://floor.example",
        () => undefined,
        fetchFn,
      ).deliver(message),
    ).rejects.toMatchObject({ status: 401 });

    expect(
      (calls[0].init?.headers as Record<string, string>).authorization,
    ).toBeUndefined();
  });

  it("throws with the status attached, so a refusal re-registers instead of retrying blind", async () => {
    const { fetchFn } = fakeFetch(401);

    await expect(
      new TelemetrySink(
        "https://floor.example",
        () => "stale",
        fetchFn,
      ).deliver(message),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("refuses an event message, because routing by kind is the proxy's job", async () => {
    const { fetchFn, calls } = fakeFetch(202);

    await expect(
      new TelemetrySink("https://floor.example", () => "t", fetchFn).deliver({
        kind: "event",
        event: {
          eventName: "kubernetes.agent.succeeded",
          source: "kubernetes",
        },
      }),
    ).rejects.toThrow(
      new Error(
        "TelemetrySink received a event message — the proxy routes by kind and should never send one here",
      ),
    );
    expect(calls).toEqual([]);
  });
});
