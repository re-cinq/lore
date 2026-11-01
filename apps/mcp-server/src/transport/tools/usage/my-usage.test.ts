import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { registerMyUsageTool } from "./my-usage.js";

const fetchMock = vi.fn();
const myUsage = toolHandlers(registerMyUsageTool, "full")["lore_my_usage"];
const textOf = async (args: Record<string, unknown>) =>
  (await myUsage(args)).content[0].text;

describe("lore_my_usage", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("LORE_API_URL", "https://lore-api.example.com");
    vi.stubEnv("LORE_INGEST_TOKEN", "tok");
    vi.stubEnv("LORE_AGENT_ID", "agent-12345678-abcd");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns the usage of the resolved agent read from /api/usage as pretty JSON", async () => {
    const usage = {
      agent_id: "agent-12345678-abcd",
      usage: { today: { tasks: 2, input_tokens: 100, output_tokens: 50 } },
    };

    fetchMock.mockResolvedValue({ ok: true, json: async () => usage });

    expect(await textOf({})).toBe(JSON.stringify(usage, null, 2));
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://lore-api.example.com/api/usage?agent_id=agent-12345678-abcd",
    );
  });

  it("url-encodes the explicit agent id dev@example.com", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    await textOf({ agent_id: "dev@example.com" });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://lore-api.example.com/api/usage?agent_id=dev%40example.com",
    );
  });

  it("reports a missing API configuration for reading usage", async () => {
    vi.stubEnv("LORE_API_URL", "");

    expect(await textOf({})).toContain(
      "Lore API not configured for reading usage",
    );
  });

  it("reports a denied token on a 403", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    });

    expect(await textOf({})).toContain(
      "Lore API denied access for lore_my_usage",
    );
  });

  it("surfaces the usage failure detail when the API answers 500", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "",
    });

    expect(await textOf({})).toMatch(
      /^Could not fetch usage from the Lore API: .*500/,
    );
  }, 10_000);
});
