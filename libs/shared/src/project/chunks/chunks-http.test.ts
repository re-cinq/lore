import { describe, it, expect } from "vitest";
import { ChunksHttp } from "./chunks-http.js";

function fakeFetch(routes: Record<string, unknown>): {
  fetchImpl: typeof fetch;
  calls: Array<{ url: string; headers: Record<string, string> }>;
} {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      headers: (init?.headers as Record<string, string>) ?? {},
    });
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const body = routes[path];
    if (body === undefined) return { ok: false, status: 404 } as Response;
    return { ok: true, status: 200, json: async () => body } as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("ChunksHttp", () => {
  it("reads spec chunks, sending the bearer token to the repo-scoped endpoint", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "/api/repos/o/r/chunks/spec": {
        specs: [{ id: "1", repo: "o/r", filePath: "s.md", content: "x" }],
      },
    });
    const http = new ChunksHttp("https://api", "o/r", "tok", fetchImpl);

    expect(await http.specChunks("o/r")).toEqual([
      { id: "1", repo: "o/r", filePath: "s.md", content: "x" },
    ]);
    expect(calls[0].url).toBe("https://api/api/repos/o/r/chunks/spec");
    expect(calls[0].headers.authorization).toBe("Bearer tok");
  });

  it("maps hasChunk and staleChunkCount to their query endpoints", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "/api/repos/o/r/chunks/has?content_type=doc&file_suffix=CLAUDE.md": {
        has: true,
      },
      "/api/repos/o/r/chunks/stale?days=90": { count: 13 },
    });
    const http = new ChunksHttp("https://api", "o/r", undefined, fetchImpl);

    expect(await http.hasChunk("o/r", "doc", "CLAUDE.md")).toBe(true);
    expect(await http.staleChunkCount("o/r", 90)).toBe(13);
    expect(calls.map((c) => c.url)).toEqual([
      "https://api/api/repos/o/r/chunks/has?content_type=doc&file_suffix=CLAUDE.md",
      "https://api/api/repos/o/r/chunks/stale?days=90",
    ]);
  });

  it("reads backfill chunks (with embeddings) via their kinds", async () => {
    const { fetchImpl } = fakeFetch({
      "/api/repos/o/r/chunks/spec-backfill": {
        specs: [
          {
            repo: "o/r",
            filePath: "s.md",
            content: "x",
            ingestedAt: "t",
            embedding: [0.1],
          },
        ],
      },
      "/api/repos/o/r/chunks/code-backfill": {
        chunks: [
          {
            filePath: "a.test.ts",
            content: "c",
            metadata: {},
            embedding: [0.2],
          },
        ],
      },
    });
    const http = new ChunksHttp("https://api", "o/r", undefined, fetchImpl);

    expect((await http.specChunksForBackfill("o/r"))[0].embedding).toEqual([
      0.1,
    ]);
    expect((await http.codeChunksForBackfill("o/r"))[0].filePath).toBe(
      "a.test.ts",
    );
  });

  it("throws on a non-ok response and on the Floor-only write surface", async () => {
    const { fetchImpl } = fakeFetch({});
    const http = new ChunksHttp("https://api", "o/r", undefined, fetchImpl);

    await expect(http.specChunks("o/r")).rejects.toThrow(
      /chunks.spec failed: 404/,
    );
    await expect(http.insertChunk("s", {} as never)).rejects.toThrow(
      /Floor-only/,
    );
  });
});
