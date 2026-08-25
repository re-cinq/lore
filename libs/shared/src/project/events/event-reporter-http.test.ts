import { describe, it, expect } from "vitest";
import { HttpEventReporter } from "./event-reporter-http.js";

/** The one call the reporter makes, captured for assertion. */
function captureFetch(response: Response): {
  calls: { url: string; init: RequestInit }[];
  fetchImpl: typeof fetch;
} {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });

    return response;
  }) as unknown as typeof fetch;

  return { calls, fetchImpl };
}

describe("HttpEventReporter", () => {
  it("posts the whole EventInsert to the router's /api/events", async () => {
    const { calls, fetchImpl } = captureFetch(
      new Response(null, { status: 202 }),
    );

    await new HttpEventReporter(
      "https://router.example",
      "tok-1",
      fetchImpl,
    ).insert({
      eventName: "kubernetes.agent_node.succeeded",
      source: "kubernetes",
      params: { assemblyLineId: "line-1", nodeId: "review" },
      dedupeKey: "cr-1:Succeeded",
    });

    expect(calls[0]?.url).toBe("https://router.example/api/events");
    expect({
      method: calls[0]?.init.method,
      auth: (calls[0]?.init.headers as Record<string, string>)["authorization"],
      body: JSON.parse(String(calls[0]?.init.body)),
    }).toEqual({
      method: "POST",
      auth: "Bearer tok-1",
      body: {
        eventName: "kubernetes.agent_node.succeeded",
        source: "kubernetes",
        params: { assemblyLineId: "line-1", nodeId: "review" },
        dedupeKey: "cr-1:Succeeded",
      },
    });
  });

  it("throws on a refusal rather than losing the event silently", async () => {
    const { fetchImpl } = captureFetch(new Response("nope", { status: 503 }));

    await expect(
      new HttpEventReporter(
        "https://router.example",
        "tok-1",
        fetchImpl,
      ).insert({ eventName: "cron.reindex.tick", source: "cron" }),
    ).rejects.toThrow(new Error("event insert failed: 503"));
  });
});
