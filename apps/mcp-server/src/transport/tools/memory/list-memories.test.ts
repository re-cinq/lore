import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resetRepoCache } from "@re-cinq/lore-server-core/features/repo/repo-detect.js";
import { writeMemoryFile } from "@re-cinq/lore-server-core/features/memory/memory-file.js";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { registerListMemoriesTool } from "./list-memories.js";

const home = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");

  process.env.HOME = mkdtempSync(`${tmpdir()}/lore-list-memories-`);

  return process.env.HOME;
});
const fetchMock = vi.fn();
const listMemories = toolHandlers(registerListMemoriesTool, "full")[
  "lore_list_memories"
];
const listInGateway = toolHandlers(registerListMemoriesTool, "agent")[
  "lore_list_memories"
];

beforeEach(() => {
  vi.stubEnv("LORE_API_URL", "https://lore-api.example.com");
  vi.stubEnv("LORE_INGEST_TOKEN", "tok");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("lore_list_memories remote proxy (no local DB)", () => {
  it("returns the proxied body on a successful list", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ memories: [], total: 0 }),
    });

    const result = await listMemories({ limit: 10, offset: 0 });

    expect(JSON.parse(result.content[0].text)).toEqual({
      memories: [],
      total: 0,
    });
  });

  it("reports a denied error on a 401 to a memory listing without retrying", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "",
    });

    const result = await listMemories({ limit: 10, offset: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toContain("denied");
  });
});

describe("lore_list_memories in the agent gateway", () => {
  it("scopes the listing to the repo the call names", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ memories: [], total: 0 }),
    });

    await listInGateway({ limit: 10, offset: 0, repo: "re-cinq/lore" });

    expect(
      JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body),
    ).toMatchObject({ action: "list", repo: "re-cinq/lore" });
  });

  it("asks the caller for the repo instead of listing agent-scoped or org-wide", async () => {
    const result = await listInGateway({ limit: 10, offset: 0 });

    expect({
      text: result.content[0].text,
      proxied: fetchMock.mock.calls.length,
    }).toEqual({
      text: "No repo given. Pass repo as owner/name (e.g. 're-cinq/lore'): the shared Lore server has no checkout to detect it from.",
      proxied: 0,
    });
  });

  it("rejects the repo re-cinq/lore?x=1 before any API call", async () => {
    const result = await listInGateway({
      limit: 10,
      offset: 0,
      repo: "re-cinq/lore?x=1",
    });

    expect({
      text: result.content[0].text,
      proxied: fetchMock.mock.calls.length,
    }).toEqual({
      text: "Invalid repo 're-cinq/lore?x=1'. Pass repo as owner/name (e.g. 're-cinq/lore').",
      proxied: 0,
    });
  });
});

describe("lore_list_memories with no API configured", () => {
  beforeEach(() => {
    vi.stubEnv("LORE_API_URL", "");
  });

  it("lists the one key first-key of agent-list from the file store", async () => {
    writeMemoryFile("first-key", "v", "agent-list");

    const result = await listMemories({
      agent_id: "agent-list",
      limit: 10,
      offset: 0,
    });

    expect(JSON.parse(result.content[0].text)).toMatchObject({
      memories: [{ key: "first-key" }],
      total: 1,
    });
  });

  it("reports a store whose memories.json holds null as a listing error", async () => {
    const dir = join(home, ".lore", "memory", "agent-null");

    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "memories.json"), "null");

    const result = await listMemories({
      agent_id: "agent-null",
      limit: 10,
      offset: 0,
    });

    expect(result.content[0].text).toMatch(/^Error listing memories: /);
  });

  it("lists without a repo scope from a directory outside any checkout", async () => {
    const checkout = process.cwd();

    writeMemoryFile("outside-key", "v", "agent-outside");
    process.chdir(home);
    resetRepoCache();

    try {
      const result = await listMemories({
        agent_id: "agent-outside",
        limit: 10,
        offset: 0,
      });

      expect(JSON.parse(result.content[0].text)).toMatchObject({
        memories: [{ key: "outside-key" }],
      });
    } finally {
      process.chdir(checkout);
      resetRepoCache();
    }
  });
});
