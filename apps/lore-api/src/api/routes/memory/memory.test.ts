import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock("@re-cinq/lore-server-core/platform/db.js", () => ({
  getHealthStatus: vi.fn(),
  isDbAvailable: vi.fn(),
  getQueryEmbedding: vi.fn(),
}));
vi.mock("@re-cinq/lore-server-core/features/memory/memory.js", () => ({
  isMemoryDbAvailable: vi.fn(),
  writeMemory: vi.fn(),
  readMemory: vi.fn(),
  deleteMemory: vi.fn(),
  listMemories: vi.fn(),
}));
vi.mock("@re-cinq/lore-server-core/features/memory/memory-file.js", () => ({
  writeMemoryFile: vi.fn(),
  readMemoryFile: vi.fn(),
  deleteMemoryFile: vi.fn(),
  listMemoriesFile: vi.fn(),
  searchMemoryFile: vi.fn(),
}));
vi.mock("@re-cinq/lore-server-core/features/memory/memory-search.js", () => ({
  searchMemories: vi.fn(),
}));
vi.mock("../../../features/memory/fact-extraction.js", () => ({
  extractFactsForMemory: vi.fn(),
}));

import { getQueryEmbedding } from "@re-cinq/lore-server-core/platform/db.js";
import {
  isMemoryDbAvailable,
  writeMemory,
  readMemory,
  deleteMemory,
  listMemories,
} from "@re-cinq/lore-server-core/features/memory/memory.js";
import {
  writeMemoryFile,
  readMemoryFile,
  deleteMemoryFile,
  listMemoriesFile,
  searchMemoryFile,
} from "@re-cinq/lore-server-core/features/memory/memory-file.js";
import { searchMemories } from "@re-cinq/lore-server-core/features/memory/memory-search.js";
import { extractFactsForMemory } from "../../../features/memory/fact-extraction.js";

const originalEnv = { ...process.env };

function inject(
  payload: string,
  headers: Record<string, string> = AUTH,
  pool: unknown = makePool(),
) {
  return buildServer(() => pool as any).inject({
    method: "POST",
    url: "/api/memory",
    headers,
    payload,
  });
}
const post = (body: unknown, pool: unknown = makePool()) =>
  inject(JSON.stringify(body), AUTH, pool);

describe("POST /api/memory", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    vi.mocked(getQueryEmbedding).mockResolvedValue([0.1, 0.2] as any);
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("writes via DB when memory DB available", async () => {
    vi.mocked(isMemoryDbAvailable).mockReturnValue(true);
    vi.mocked(writeMemory).mockResolvedValue({ id: 1 } as any);
    const res = await post({ action: "write", key: "k", value: "v" });

    expect(res.result).toEqual({ id: 1 });
    expect(getQueryEmbedding).toHaveBeenCalledWith("v");
  });

  it("extracts facts after a DB write when extract_facts is set", async () => {
    vi.mocked(isMemoryDbAvailable).mockReturnValue(true);
    vi.mocked(writeMemory).mockResolvedValue({ key: "k", version: 1 } as never);
    vi.mocked(extractFactsForMemory).mockResolvedValue(undefined);
    await post({
      action: "write",
      key: "k",
      value: "v",
      agent_id: "agent-7",
      repo: "o/r",
      extract_facts: true,
    });

    expect(vi.mocked(extractFactsForMemory).mock.calls[0][1]).toEqual({
      key: "k",
      value: "v",
      agentId: "agent-7",
      repo: "o/r",
    });
  });

  it("skips fact extraction when extract_facts is absent", async () => {
    vi.mocked(isMemoryDbAvailable).mockReturnValue(true);
    vi.mocked(writeMemory).mockResolvedValue({ key: "k", version: 1 } as never);
    await post({ action: "write", key: "k", value: "v" });

    expect(extractFactsForMemory).not.toHaveBeenCalled();
  });

  it("writes via file fallback when memory DB unavailable", async () => {
    vi.mocked(isMemoryDbAvailable).mockReturnValue(false);
    vi.mocked(writeMemoryFile).mockReturnValue({ id: "f" } as any);
    const res = await post({ action: "write", key: "k", value: "v" });

    expect(res.result).toEqual({ id: "f" });
  });

  it("parses a JSON body sent with a non-JSON Content-Type", async () => {
    vi.mocked(isMemoryDbAvailable).mockReturnValue(true);
    vi.mocked(writeMemory).mockResolvedValue({ id: 7 } as any);
    const res = await inject(
      JSON.stringify({ action: "write", key: "k", value: "v" }),
      { ...AUTH, "content-type": "application/x-www-form-urlencoded" },
    );

    expect(res.result).toEqual({ id: 7 });
  });

  it("returns 400 when write is missing value", async () => {
    const res = await post({ action: "write", key: "k" });

    expect(res.statusCode).toBe(400);
  });

  it("reads via DB", async () => {
    vi.mocked(isMemoryDbAvailable).mockReturnValue(true);
    vi.mocked(readMemory).mockResolvedValue({ value: "v" } as any);
    const res = await post({ action: "read", key: "k", version: "3" });

    expect(res.result).toEqual({ value: "v" });
    expect(readMemory).toHaveBeenCalledWith("k", undefined, 3);
  });

  it("reads full history via DB with version=all", async () => {
    vi.mocked(isMemoryDbAvailable).mockReturnValue(true);
    vi.mocked(readMemory).mockResolvedValue([{ v: 1 }] as any);
    await post({ action: "read", key: "k", version: "all" });
    expect(readMemory).toHaveBeenCalledWith("k", undefined, "all");
  });

  it("reads latest via DB when no version given", async () => {
    vi.mocked(isMemoryDbAvailable).mockReturnValue(true);
    vi.mocked(readMemory).mockResolvedValue({ v: 1 } as any);
    await post({ action: "read", key: "k" });
    expect(readMemory).toHaveBeenCalledWith("k", undefined, undefined);
  });

  it("reads a numeric version via file fallback", async () => {
    vi.mocked(isMemoryDbAvailable).mockReturnValue(false);
    vi.mocked(readMemoryFile).mockReturnValue({ v: 2 } as any);
    await post({ action: "read", key: "k", version: "2" });
    expect(readMemoryFile).toHaveBeenCalledWith("k", undefined, 2);
  });

  it("reads full history via file with version=all", async () => {
    vi.mocked(isMemoryDbAvailable).mockReturnValue(false);
    vi.mocked(readMemoryFile).mockReturnValue([{ v: 1 }] as any);
    await post({ action: "read", key: "k", version: "all" });
    expect(readMemoryFile).toHaveBeenCalledWith("k", undefined, "all");
  });

  it("reads latest via file fallback when no version given", async () => {
    vi.mocked(isMemoryDbAvailable).mockReturnValue(false);
    vi.mocked(readMemoryFile).mockReturnValue({ v: 1 } as any);
    await post({ action: "read", key: "k" });
    expect(readMemoryFile).toHaveBeenCalledWith("k", undefined, undefined);
  });

  it("writes with undefined embedding when the embedder returns falsy", async () => {
    vi.mocked(isMemoryDbAvailable).mockReturnValue(true);
    vi.mocked(getQueryEmbedding).mockResolvedValue(null as any);
    vi.mocked(writeMemory).mockResolvedValue({ id: 1 } as any);
    await post({ action: "write", key: "k", value: "v" });
    expect(writeMemory).toHaveBeenCalledWith({
      key: "k",
      value: "v",
      agentId: undefined,
      ttl: undefined,
      embedding: undefined,
      repo: undefined,
    });
  });

  it("returns 400 when read is missing key", async () => {
    const res = await post({ action: "read" });

    expect(res.statusCode).toBe(400);
  });

  it("searches via DB", async () => {
    vi.mocked(isMemoryDbAvailable).mockReturnValue(true);
    vi.mocked(searchMemories).mockResolvedValue([{ m: 1 }] as any);
    const res = await post({ action: "search", query: "q" });

    expect(res.result).toEqual([{ m: 1 }]);
    expect(getQueryEmbedding).toHaveBeenCalledWith("q");
  });

  it("forwards include_invalidated and graph_augment to the searcher", async () => {
    vi.mocked(isMemoryDbAvailable).mockReturnValue(true);
    vi.mocked(searchMemories).mockResolvedValue([] as never);
    await post({
      action: "search",
      query: "q",
      limit: 5,
      include_invalidated: true,
      graph_augment: true,
    });

    expect(vi.mocked(searchMemories).mock.calls[0].slice(1)).toEqual([
      "q",
      {
        agentId: undefined,
        poolName: undefined,
        limit: 5,
        includeInvalidated: true,
        graphAugment: true,
      },
    ]);
  });

  it("defaults include_invalidated and graph_augment to false", async () => {
    vi.mocked(isMemoryDbAvailable).mockReturnValue(true);
    vi.mocked(searchMemories).mockResolvedValue([] as never);
    await post({ action: "search", query: "q" });

    expect(vi.mocked(searchMemories).mock.calls[0][2]).toMatchObject({
      includeInvalidated: false,
      graphAugment: false,
    });
  });

  it("searches via file fallback", async () => {
    vi.mocked(isMemoryDbAvailable).mockReturnValue(false);
    vi.mocked(searchMemoryFile).mockReturnValue([] as any);
    await post({ action: "search", query: "q" });
    expect(searchMemoryFile).toHaveBeenCalledWith("q", undefined, 10);
  });

  it("returns 400 when search is missing query", async () => {
    const res = await post({ action: "search" });

    expect(res.statusCode).toBe(400);
  });

  it("deletes via DB", async () => {
    vi.mocked(isMemoryDbAvailable).mockReturnValue(true);
    vi.mocked(deleteMemory).mockResolvedValue({ ok: true } as any);
    const res = await post({ action: "delete", key: "k" });

    expect(res.result).toEqual({ ok: true });
  });

  it("deletes via file fallback", async () => {
    vi.mocked(isMemoryDbAvailable).mockReturnValue(false);
    vi.mocked(deleteMemoryFile).mockReturnValue({ ok: 1 } as any);
    await post({ action: "delete", key: "k" });
    expect(deleteMemoryFile).toHaveBeenCalled();
  });

  it("returns 400 when delete is missing key", async () => {
    const res = await post({ action: "delete" });

    expect(res.statusCode).toBe(400);
  });

  it("lists via DB with default limit 50 offset 0", async () => {
    vi.mocked(isMemoryDbAvailable).mockReturnValue(true);
    vi.mocked(listMemories).mockResolvedValue({
      memories: [{ k: 1 }],
      total: 1,
    } as any);
    await post({ action: "list" });
    expect(listMemories).toHaveBeenCalledWith(undefined, 50, 0);
  });

  it("threads offset through and echoes paging metadata", async () => {
    vi.mocked(isMemoryDbAvailable).mockReturnValue(true);
    vi.mocked(listMemories).mockResolvedValue({
      memories: [{ k: 2 }],
      total: 9,
    } as any);
    const res = await post({ action: "list", limit: 5, offset: 5 });

    expect(listMemories).toHaveBeenCalledWith(undefined, 5, 5);
    expect(res.result).toEqual({
      memories: [{ k: 2 }],
      total: 9,
      limit: 5,
      offset: 5,
    });
  });

  it("caps the list limit at 100", async () => {
    vi.mocked(isMemoryDbAvailable).mockReturnValue(true);
    vi.mocked(listMemories).mockResolvedValue({
      memories: [],
      total: 0,
    } as any);
    await post({ action: "list", limit: 999 });
    expect(listMemories).toHaveBeenCalledWith(undefined, 100, 0);
  });

  it("lists via file fallback", async () => {
    vi.mocked(isMemoryDbAvailable).mockReturnValue(false);
    vi.mocked(listMemoriesFile).mockReturnValue({
      memories: [],
      total: 0,
    } as any);
    await post({ action: "list", offset: 3 });
    expect(listMemoriesFile).toHaveBeenCalledWith(undefined, 50, 3);
  });

  it("returns 400 for an unknown action", async () => {
    const res = await post({ action: "frobnicate" });

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 on invalid JSON, not 500", async () => {
    const res = await inject("{bad");

    expect(res.statusCode).toBe(400);
  });

  it("returns 401 when the bearer token is absent", async () => {
    const res = await inject(JSON.stringify({ action: "list" }), {});

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.payload)).toEqual({ error: "unauthorized" });
  });

  it("returns 403 when the token lacks write scope", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [{ scopes: ["read"] }] });
    const res = await inject(
      JSON.stringify({ action: "list" }),
      { authorization: "Bearer read-only" },
      pool,
    );

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload)).toEqual({ error: "insufficient scope" });
  });
});
