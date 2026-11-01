import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { registerAgentStatsTool } from "./agent-stats.js";

const agentStats = toolHandlers(registerAgentStatsTool, "full")[
  "lore_agent_stats"
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

describe("lore_agent_stats remote proxy (no local DB)", () => {
  it("proxies to GET /api/agent-stats for the resolved agent and prints the JSON", async () => {
    const stats = { memory_count: 4, recent_episodes: { total_count: 17 } };

    fetchMock.mockResolvedValue({ ok: true, json: async () => stats });

    const result = await agentStats({});
    const [calledUrl, opts] = fetchMock.mock.calls[0];

    expect({
      calledUrl,
      authorization: (opts as { headers: Record<string, string> }).headers
        .Authorization,
      printed: JSON.parse(result.content[0].text),
    }).toEqual({
      calledUrl:
        "https://lore-api.example.com/api/agent-stats?agent_id=agent-7",
      authorization: "Bearer tok",
      printed: stats,
    });
  });

  it("reports a missing API configuration instead of a PostgreSQL message", async () => {
    vi.stubEnv("LORE_API_URL", "");

    const result = await agentStats({});

    expect(result.content[0].text).toContain(
      "Lore API not configured for fetching agent stats",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a denied error on a 401", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "",
    });

    const result = await agentStats({ agent_id: "agent-x" });

    expect(result.content[0].text).toContain("denied");
  });

  it("passes on the API's own message for a 400", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: async () => JSON.stringify({ error: "agent_id: unknown" }),
    });

    const result = await agentStats({});

    expect(result.content[0].text).toBe(
      "Could not fetch agent stats from the Lore API: HTTP 400 Bad Request: agent_id: unknown",
    );
  });

  it("reports an API answer with no JSON body as a stats error", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => undefined });

    const result = await agentStats({});

    expect(result.content[0].text).toMatch(/^Error fetching agent stats: /);
  });
});
