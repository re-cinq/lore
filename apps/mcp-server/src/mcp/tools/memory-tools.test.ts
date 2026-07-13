import {
  describe,
  it,
  expect,
  beforeAll,
  afterEach,
  beforeEach,
  vi,
} from "vitest";

// No pg pool is configured, so isMemoryDbAvailable() is false and lore_query_graph
// takes the remote-proxy branch. We register the real handler and stub global
// fetch to assert the HTTP request it makes to /api/graph.

type ToolHandler = (
  args: Record<string, unknown>,
) => Promise<{ content: { type: string; text: string }[] }>;

let queryGraph: ToolHandler;
const originalEnv = { ...process.env };
const fetchMock = vi.fn();

beforeAll(async () => {
  const { registerMemoryTools } = await import("./memory-tools.js");
  const handlers: Record<string, ToolHandler> = {};
  const fakeServer = {
    tool(name: string, _desc: string, _schema: unknown, handler: ToolHandler) {
      handlers[name] = handler;
    },
  };
  registerMemoryTools(fakeServer as never, { getPool: () => null });
  queryGraph = handlers["lore_query_graph"];
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
    expect(JSON.parse(result.content[0].text)).toEqual(rows);
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
