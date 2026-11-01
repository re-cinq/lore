import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeMemoryFile } from "@re-cinq/lore-server-core/features/memory/memory-file.js";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { registerSearchMemoryTool } from "./search-memory.js";

const home = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");

  process.env.HOME = mkdtempSync(`${tmpdir()}/lore-search-memory-`);

  return process.env.HOME;
});
const fetchMock = vi.fn();
const searchMemory = toolHandlers(registerSearchMemoryTool, "full")[
  "lore_search_memory"
];
const searchInGateway = toolHandlers(registerSearchMemoryTool, "agent")[
  "lore_search_memory"
];
const sentBody = () =>
  JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);

beforeEach(() => {
  vi.stubEnv("LORE_API_URL", "https://lore-api.example.com");
  vi.stubEnv("LORE_INGEST_TOKEN", "tok");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ results: [], notes: [] }),
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("lore_search_memory backend param", () => {
  it("gives a memory search 45s per attempt", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    await searchMemory({ query: "timeout probe memory", limit: 10 });

    expect(timeoutSpy).toHaveBeenCalledWith(45_000);
  });

  it("forwards backend both to POST /api/memory and prints the API's answer", async () => {
    const answer = {
      results: [],
      notes: ["search_memory: no Utopia reader yet"],
    };

    fetchMock.mockResolvedValue({ ok: true, json: async () => answer });
    const result = await searchMemory({
      query: "deploys",
      limit: 10,
      backend: "both",
    });

    expect({
      sent: sentBody(),
      printed: JSON.parse(result.content[0].text),
    }).toMatchObject({
      sent: { action: "search", query: "deploys", backend: "both" },
      printed: answer,
    });
  });

  it("refuses backend utopia instead of searching the local file store when no API is configured", async () => {
    vi.stubEnv("LORE_API_URL", "");
    const result = await searchMemory({
      query: "deploys",
      limit: 10,
      backend: "utopia",
    });

    expect(result.content[0].text).toBe(
      "backend utopia is answered by the Lore API only; set LORE_API_URL. The offline search reads Lore's stores alone.",
    );
  });
});

describe("lore_search_memory with no API configured", () => {
  it("finds the memory holding egress in the file store for backend lore", async () => {
    vi.stubEnv("LORE_API_URL", "");
    writeMemoryFile("net", "egress opens node-local-dns", "agent-search");

    const result = await searchMemory({
      query: "egress",
      agent_id: "agent-search",
      limit: 10,
      backend: "lore",
    });

    expect(result.content[0].text).toContain("egress opens node-local-dns");
  });
});

describe("lore_search_memory repo scope in the agent gateway", () => {
  it("forwards the repo re-cinq/lore the call names with the search to POST /api/memory", async () => {
    await searchInGateway({
      query: "egress policies",
      limit: 10,
      repo: "re-cinq/lore",
    });

    expect(sentBody()).toMatchObject({
      action: "search",
      query: "egress policies",
      repo: "re-cinq/lore",
    });
  });

  it("searches org-wide when the gateway call names no repo", async () => {
    await searchInGateway({ query: "gateway only query", limit: 10 });

    expect(sentBody()).not.toHaveProperty("repo");
  });

  it("refuses the repo ../lore before any API call", async () => {
    const result = await searchInGateway({
      query: "q",
      limit: 10,
      repo: "../lore",
    });

    expect({
      text: result.content[0].text,
      proxied: fetchMock.mock.calls.length,
    }).toEqual({
      text: "Invalid repo '../lore'. Pass repo as owner/name (e.g. 're-cinq/lore').",
      proxied: 0,
    });
  });
});

describe("lore_search_memory failures", () => {
  it("reports a store whose memories.json holds null as a search error", async () => {
    const dir = join(home, ".lore", "memory", "agent-null");

    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "memories.json"), "null");
    vi.stubEnv("LORE_API_URL", "");

    const result = await searchMemory({
      query: "q",
      agent_id: "agent-null",
      limit: 10,
      backend: "lore",
    });

    expect(result.content[0].text).toMatch(/^Error searching memories: /);
  });
});
