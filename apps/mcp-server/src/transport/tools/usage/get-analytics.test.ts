import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { registerGetAnalyticsTool } from "./get-analytics.js";

const fetchMock = vi.fn();
const getAnalytics = toolHandlers(registerGetAnalyticsTool, "full")[
  "lore_get_analytics"
];
const textOf = async (args: Record<string, unknown>) =>
  (await getAnalytics(args)).content[0].text;

describe("lore_get_analytics", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("LORE_API_URL", "https://lore-api.example.com");
    vi.stubEnv("LORE_INGEST_TOKEN", "tok");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns the month's analytics read from /api/analytics?period=month as pretty JSON", async () => {
    const analytics = {
      period: "month",
      usage: { llm_calls: 12, input_tokens: 900, output_tokens: 300 },
      tasks: { total: 10, succeeded: 7, failed: 2 },
      by_type: [{ task_type: "implementation", tasks: "6" }],
    };

    fetchMock.mockResolvedValue({ ok: true, json: async () => analytics });

    expect(await textOf({ period: "month" })).toBe(
      JSON.stringify(analytics, null, 2),
    );
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://lore-api.example.com/api/analytics?period=month",
    );
  });

  it("reports a missing API configuration for fetching analytics", async () => {
    vi.stubEnv("LORE_API_URL", "");

    expect(await textOf({ period: "today" })).toContain(
      "Lore API not configured for fetching analytics",
    );
  });

  it("surfaces why analytics could not be fetched when the API body is not JSON", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error("Unexpected token <");
      },
      text: async () => "<html>",
    });

    expect(await textOf({ period: "today" })).toMatch(
      /^Could not fetch analytics from the Lore API: /,
    );
  }, 10_000);
});
