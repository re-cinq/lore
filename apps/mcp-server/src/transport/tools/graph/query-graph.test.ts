import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { registerQueryGraphTool } from "./query-graph.js";

const queryGraph = toolHandlers(registerQueryGraphTool, "full")[
  "lore_query_graph"
];
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv("LORE_API_URL", "https://lore-api.example.com");
  vi.stubEnv("LORE_INGEST_TOKEN", "tok");
  vi.stubEnv("LORE_AGENT_ID", "agent-7");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("lore_query_graph remote proxy (no local DB)", () => {
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

    expect({
      calledUrl,
      authorization: (opts as { headers: Record<string, string> }).headers
        .Authorization,
      printed: JSON.parse(result.content[0].text),
    }).toEqual({
      calledUrl:
        "https://lore-api.example.com/api/graph?entity=auth-service&relation_type=uses",
      authorization: "Bearer tok",
      printed: { results: rows },
    });
  });

  it("sends repo re-cinq/lore and include_invalidated=true when the call asks for them", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => [] });

    await queryGraph({ repo: "re-cinq/lore", include_invalidated: true });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://lore-api.example.com/api/graph?repo=re-cinq%2Flore&include_invalidated=true",
    );
  });

  it("falls back to the not-configured message when LORE_API_URL is unset", async () => {
    vi.stubEnv("LORE_API_URL", "");

    const result = await queryGraph({ entity: "x" });

    expect({
      text: result.content[0].text,
      proxied: fetchMock.mock.calls.length,
    }).toEqual({
      text: "Knowledge graph requires PostgreSQL (LORE_DB_HOST) or a configured LORE_API_URL.",
      proxied: 0,
    });
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
