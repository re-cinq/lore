import { describe, expect, it } from "vitest";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import { ApiContextSource } from "./api-context-source.js";

const SPEC: LoreTaskSpec = {
  taskId: "task-1",
  taskType: "implementation",
  description: "add the claim loop",
  prompt: "do it",
  targetRepo: "re-cinq/lore",
  branch: "feat/thing",
};

const jsonResponse = (status: number, body: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }) as Response;

function fakeFetch(response: Response): {
  fetchFn: typeof fetch;
  calls: Array<{ url: string; init: RequestInit }>;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = ((url: string, init: RequestInit) => {
    calls.push({ url, init });

    return Promise.resolve(response);
  }) as unknown as typeof fetch;

  return { fetchFn, calls };
}

describe("ApiContextSource", () => {
  it("fetches /api/context with repo, template, query and the bearer token", async () => {
    const { fetchFn, calls } = fakeFetch(
      jsonResponse(200, { text: "conventions..." }),
    );
    const source = new ApiContextSource(
      "https://lore-api.example.com",
      "ingest-token",
      fetchFn,
    );

    expect(await source.assemble(SPEC)).toBe("conventions...");
    expect(calls[0].url).toBe(
      "https://lore-api.example.com/api/context?repo=re-cinq%2Flore" +
        "&template=implementation&query=add%20the%20claim%20loop&max_tokens=8000",
    );
    expect(calls[0].init.headers).toMatchObject({
      authorization: "Bearer ingest-token",
    });
  });

  it("uses the review template for a review task", async () => {
    const { fetchFn, calls } = fakeFetch(jsonResponse(200, { text: "ctx" }));

    await new ApiContextSource("https://api", "tok", fetchFn).assemble({
      ...SPEC,
      taskType: "review",
    });

    expect(calls[0].url).toContain("&template=review&");
  });

  it("returns undefined on a non-200 response", async () => {
    const { fetchFn } = fakeFetch(jsonResponse(503, { error: "down" }));

    expect(
      await new ApiContextSource("https://api", "tok", fetchFn).assemble(SPEC),
    ).toBeUndefined();
  });

  it("returns undefined when the response carries no text", async () => {
    const { fetchFn } = fakeFetch(jsonResponse(200, { text: "  " }));

    expect(
      await new ApiContextSource("https://api", "tok", fetchFn).assemble(SPEC),
    ).toBeUndefined();
  });

  it("returns undefined when the fetch rejects", async () => {
    const fetchFn = (() =>
      Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch;

    expect(
      await new ApiContextSource("https://api", "tok", fetchFn).assemble(SPEC),
    ).toBeUndefined();
  });
});
