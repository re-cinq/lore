import {
  describe,
  it,
  expect,
  beforeAll,
  afterEach,
  beforeEach,
  vi,
} from "vitest";
import { toolHandlers, type ToolHandler } from "./tool-test-helpers.js";

let queryGraph: ToolHandler;
let writeMemory: ToolHandler;
let readMemory: ToolHandler;
let listMemories: ToolHandler;
const originalEnv = { ...process.env };
const fetchMock = vi.fn();

beforeAll(async () => {
  const { registerMemoryTools } = await import("./memory-tools.js");
  const handlers = toolHandlers(registerMemoryTools, "full");

  queryGraph = handlers["lore_query_graph"];
  writeMemory = handlers["lore_write_memory"];
  readMemory = handlers["lore_read_memory"];
  listMemories = handlers["lore_list_memories"];
});

describe("lore_query_graph remote proxy (no local DB)", () => {
  beforeEach(() => {
    process.env.LORE_API_URL = "https://lore-api.example.com";
    process.env.LORE_INGEST_TOKEN = "tok";
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("proxies to GET /api/graph with the query params and bearer token", async () => {
    const rows = [
      { entity: "auth-service", relation: "uses", related_entity: "postgres" },
    ];

    fetchMock.mockResolvedValue({ ok: true, json: async () => rows });

    const result = await queryGraph({
      entity: "auth-service",
      relation_type: "uses",
      include_invalidated: false,
    });

    const [calledUrl, opts] = fetchMock.mock.calls[0];

    expect(calledUrl).toBe(
      "https://lore-api.example.com/api/graph?entity=auth-service&relation_type=uses",
    );
    expect((opts as any).headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(result.content[0].text)).toEqual({ results: rows });
  });

  it("falls back to the not-configured message when LORE_API_URL is unset", async () => {
    delete process.env.LORE_API_URL;

    const result = await queryGraph({ entity: "x" });

    expect(result.content[0].text).toMatch(
      /requires PostgreSQL .*or a configured LORE_API_URL/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("lore_write_memory remote proxy (no local DB)", () => {
  beforeEach(() => {
    process.env.LORE_API_URL = "https://lore-api.example.com";
    process.env.LORE_INGEST_TOKEN = "tok";
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("returns the proxied body on a successful write", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ key: "k", version: 1 }),
    });

    const result = await writeMemory({ key: "k", value: "v" });

    expect(JSON.parse(result.content[0].text)).toEqual({
      key: "k",
      version: 1,
    });
  });

  it("reports a denied error on a 401 without retrying", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "",
    });

    const result = await writeMemory({ key: "k", value: "v" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toContain("denied");
  });

  it("in the agent gateway scopes the write to the repo the call names", async () => {
    const { registerMemoryTools } = await import("./memory-tools.js");
    const handlers = toolHandlers(registerMemoryTools, "agent");

    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

    await handlers["lore_write_memory"]({
      key: "k",
      value: "v",
      repo: "re-cinq/lore",
    });

    expect(
      JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body),
    ).toMatchObject({ action: "write", key: "k", repo: "re-cinq/lore" });
  });

  it("reports a 400 as the API rejecting the call with its reason, not as an unreachable API", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: async () => JSON.stringify({ error: "key: required" }),
    });

    const result = await writeMemory({ key: "k", value: "v" });

    expect(result.content[0].text).toBe(
      "Lore API rejected lore_write_memory: HTTP 400 Bad Request: key: required",
    );
  });
});

describe("lore_read_memory remote proxy (no local DB)", () => {
  beforeEach(() => {
    process.env.LORE_API_URL = "https://lore-api.example.com";
    process.env.LORE_INGEST_TOKEN = "tok";
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("returns the proxied body on a successful read", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ key: "k", value: "v" }),
    });

    const result = await readMemory({ key: "k" });

    expect(JSON.parse(result.content[0].text)).toEqual({
      key: "k",
      value: "v",
    });
  });

  it("reports a denied error on a 401 without retrying", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "",
    });

    const result = await readMemory({ key: "k" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toContain("denied");
  });
});

describe("lore_list_memories remote proxy (no local DB)", () => {
  beforeEach(() => {
    process.env.LORE_API_URL = "https://lore-api.example.com";
    process.env.LORE_INGEST_TOKEN = "tok";
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("returns the proxied body on a successful list", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ memories: [], total: 0 }),
    });

    const result = await listMemories({ limit: 10 });

    expect(JSON.parse(result.content[0].text)).toEqual({
      memories: [],
      total: 0,
    });
  });

  it("reports a denied error on a 401 without retrying", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "",
    });

    const result = await listMemories({ limit: 10 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toContain("denied");
  });
});

describe("lore_query_graph denied response", () => {
  beforeEach(() => {
    process.env.LORE_API_URL = "https://lore-api.example.com";
    process.env.LORE_INGEST_TOKEN = "tok";
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("reports a denied error on a 403 without retrying", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: async () => "",
    });

    const result = await queryGraph({ entity: "x" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toContain("denied");
  });
});

describe("lore_agent_stats remote proxy (no local DB)", () => {
  let agentStats: ToolHandler;

  beforeEach(async () => {
    const { registerMemoryTools } = await import("./memory-tools.js");
    const handlers = toolHandlers(registerMemoryTools, "full");

    agentStats = handlers["lore_agent_stats"];
    process.env.LORE_API_URL = "https://lore-api.example.com";
    process.env.LORE_INGEST_TOKEN = "tok";
    process.env.LORE_AGENT_ID = "agent-7";
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("proxies to GET /api/agent-stats for the resolved agent and prints the JSON", async () => {
    const stats = { memory_count: 4, recent_episodes: { total_count: 17 } };

    fetchMock.mockResolvedValue({ ok: true, json: async () => stats });

    const result = await agentStats({});
    const [calledUrl, opts] = fetchMock.mock.calls[0];

    expect(calledUrl).toBe(
      "https://lore-api.example.com/api/agent-stats?agent_id=agent-7",
    );
    expect(
      (opts as { headers: Record<string, string> }).headers.Authorization,
    ).toBe("Bearer tok");
    expect(JSON.parse(result.content[0].text)).toEqual(stats);
  });

  it("reports a missing API configuration instead of a PostgreSQL message", async () => {
    delete process.env.LORE_API_URL;

    const result = await agentStats({});

    expect(result.content[0].text).toContain(
      "Lore API not configured for fetching agent stats",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("lore_list_memories in the agent gateway", () => {
  beforeEach(() => {
    process.env.LORE_API_URL = "https://lore-api.example.com";
    process.env.LORE_INGEST_TOKEN = "tok";
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("scopes the listing to the repo the call names", async () => {
    const { registerMemoryTools } = await import("./memory-tools.js");
    const handlers = toolHandlers(registerMemoryTools, "agent");

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ memories: [], total: 0 }),
    });

    await handlers["lore_list_memories"]({
      limit: 10,
      offset: 0,
      repo: "re-cinq/lore",
    });

    expect(
      JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body),
    ).toMatchObject({ action: "list", repo: "re-cinq/lore" });
  });
});

describe("lore_list_memories and lore_write_memory refuse a repo they cannot scope to", () => {
  beforeEach(() => {
    process.env.LORE_API_URL = "https://lore-api.example.com";
    process.env.LORE_INGEST_TOKEN = "tok";
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("asks the agent gateway's caller for the repo instead of listing agent-scoped or org-wide", async () => {
    const { registerMemoryTools } = await import("./memory-tools.js");
    const handlers = toolHandlers(registerMemoryTools, "agent");

    const result = await handlers["lore_list_memories"]({
      limit: 10,
      offset: 0,
    });

    expect({
      text: result.content[0].text,
      proxied: fetchMock.mock.calls.length,
    }).toEqual({
      text: "No repo given. Pass repo as owner/name (e.g. 're-cinq/lore'): the shared Lore server has no checkout to detect it from.",
      proxied: 0,
    });
  });

  it("rejects a repo that is not owner/name before any API call", async () => {
    const { registerMemoryTools } = await import("./memory-tools.js");
    const handlers = toolHandlers(registerMemoryTools, "agent");

    const results = await Promise.all([
      handlers["lore_list_memories"]({
        limit: 10,
        offset: 0,
        repo: "re-cinq/lore?x=1",
      }),
      handlers["lore_write_memory"]({
        key: "k",
        value: "v",
        repo: "../lore",
      }),
    ]);

    expect({
      texts: results.map((r) => r.content[0].text),
      proxied: fetchMock.mock.calls.length,
    }).toEqual({
      texts: [
        "Invalid repo 're-cinq/lore?x=1'. Pass repo as owner/name (e.g. 're-cinq/lore').",
        "Invalid repo '../lore'. Pass repo as owner/name (e.g. 're-cinq/lore').",
      ],
      proxied: 0,
    });
  });
});
