import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock("@re-cinq/lore-server-core/features/memory/facts.js", () => ({
  extractFactsFromEpisode: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@re-cinq/lore-server-core/features/memory/graph.js", () => ({
  extractAndUpdateGraph: vi.fn(),
}));
vi.mock("@re-cinq/lore-shared", () => ({
  redactSecrets: (s: string) => s,
  parseTasks: vi.fn(),
  inferPhaseDependencies: vi.fn(),
  parseTrailers: vi.fn(),
  parseSpecTitle: vi.fn(),
  extractSummary: vi.fn(),
  reassembleSpec: vi.fn(),
  Llm: { instance: { complete: vi.fn().mockResolvedValue({ text: "ok" }) } },
}));

import { extractFactsFromEpisode } from "@re-cinq/lore-server-core/features/memory/facts.js";
import { extractAndUpdateGraph } from "@re-cinq/lore-server-core/features/memory/graph.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

const post = (
  body: unknown,
  pool: unknown = makePool(),
  headers: Record<string, string> = AUTH,
) =>
  buildServer(() => pool as any).inject({
    method: "POST",
    url: "/api/episode",
    headers,
    payload: JSON.stringify(body),
  });

describe("POST /api/episode", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("returns 400 when content is missing", async () => {
    const res = await post({});

    expect(res.statusCode).toBe(400);
  });

  it("returns 403 when the token lacks write scope", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [{ scopes: ["read"] }] });
    const res = await post({ content: "x" }, pool, {
      authorization: "Bearer read-only",
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload)).toEqual({ error: "insufficient scope" });
  });

  it("returns duplicate when the insert conflicts", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [] });
    const res = await post({ content: "hello" }, pool);

    expect(res.result).toEqual({ status: "duplicate" });
  });

  it("stores a new episode and runs the graph LLM closure when key is set", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    let closureRan = false;

    vi.mocked(extractAndUpdateGraph).mockImplementation(
      async (...args: any[]) => {
        const llm = args[3];

        if (llm) {
          await llm("prompt");
          closureRan = true;
        }
      },
    );
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [{ id: 99 }] });
    const res = await post(
      { content: "a new observation", agent_id: "a1" },
      pool,
    );

    expect(res.result).toEqual({ status: "ok", episode_id: 99 });
    expect(extractFactsFromEpisode).toHaveBeenCalled();
    await vi.waitFor(() => expect(closureRan).toBe(true));
  });

  it("skips graph extraction when ANTHROPIC_API_KEY is unset", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [{ id: 5 }] });
    const res = await post({ content: "another observation" }, pool);

    expect(res.result).toEqual({ status: "ok", episode_id: 5 });
    expect(extractAndUpdateGraph).not.toHaveBeenCalled();
  });

  it("returns 500 when the episode insert throws", async () => {
    const pool = makePool();

    pool.query.mockRejectedValue(new Error("insert fail"));
    const res = await post({ content: "boom" }, pool);

    expect(res.statusCode).toBe(500);
  });

  it("swallows a failing fact extraction", async () => {
    vi.mocked(extractFactsFromEpisode).mockRejectedValueOnce(
      new Error("facts fail"),
    );
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [{ id: 11 }] });
    const res = await post({ content: "obs for facts reject" }, pool);

    expect(res.result).toEqual({ status: "ok", episode_id: 11 });
    await new Promise((r) => setTimeout(r, 5));
  });

  it("swallows a failing graph update", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    globalThis.fetch = vi.fn() as typeof fetch;
    vi.mocked(extractAndUpdateGraph).mockRejectedValueOnce(
      new Error("graph fail"),
    );
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [{ id: 12 }] });
    const res = await post({ content: "obs for graph reject" }, pool);

    expect(res.result).toEqual({ status: "ok", episode_id: 12 });
    await new Promise((r) => setTimeout(r, 5));
  });
});
