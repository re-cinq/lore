import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("./deps.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./deps.js")>()),
  proxyGetApi: vi.fn(),
}));

import { proxyGetApi } from "./deps.js";
import { registerUsageTools } from "./usage-tools.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
}>;

const originalEnv = { ...process.env };
const proxy = vi.mocked(proxyGetApi);

function handlers(): Record<string, ToolHandler> {
  const registered: Record<string, ToolHandler> = {};
  const fakeServer = {
    tool(name: string, _desc: string, _schema: unknown, handler: ToolHandler) {
      registered[name] = handler;
    },
  };

  registerUsageTools(fakeServer as never);

  return registered;
}

const text = (result: { content: { text: string }[] }) =>
  result.content[0].text;

afterEach(() => {
  process.env = { ...originalEnv };
  vi.clearAllMocks();
});

describe("lore_my_usage", () => {
  beforeEach(() => {
    process.env.LORE_AGENT_ID = "agent-12345678-abcd";
  });

  it("returns the API's usage object as pretty-printed JSON", async () => {
    const usage = {
      agent_id: "agent-12345678-abcd",
      usage: {
        today: { tasks: 2, input_tokens: 100, output_tokens: 50 },
      },
    };

    proxy.mockResolvedValue({ ok: true, body: JSON.stringify(usage) });

    expect(text(await handlers()["lore_my_usage"]({}))).toBe(
      JSON.stringify(usage, null, 2),
    );
  });

  it("requests /api/usage for the resolved agent id", async () => {
    proxy.mockResolvedValue({ ok: true, body: "{}" });
    await handlers()["lore_my_usage"]({});

    expect(proxy).toHaveBeenCalledWith(
      "/api/usage?agent_id=agent-12345678-abcd",
    );
  });

  it("url-encodes an explicit agent id", async () => {
    proxy.mockResolvedValue({ ok: true, body: "{}" });
    await handlers()["lore_my_usage"]({ agent_id: "dev@example.com" });

    expect(proxy).toHaveBeenCalledWith("/api/usage?agent_id=dev%40example.com");
  });

  it("reports a missing API configuration instead of a PostgreSQL message", async () => {
    proxy.mockResolvedValue({ ok: false, reason: "not_configured" });

    expect(text(await handlers()["lore_my_usage"]({}))).toContain(
      "Lore API not configured for reading usage",
    );
  });

  it("reports a denied token", async () => {
    proxy.mockResolvedValue({
      ok: false,
      reason: "denied",
      detail: "HTTP 403 Forbidden",
    });

    expect(text(await handlers()["lore_my_usage"]({}))).toContain(
      "Lore API denied access for lore_my_usage",
    );
  });

  it("surfaces the failure detail when the API is unreachable", async () => {
    proxy.mockResolvedValue({
      ok: false,
      reason: "unreachable",
      detail: "request timed out (15s)",
    });

    expect(text(await handlers()["lore_my_usage"]({}))).toBe(
      "Could not fetch usage from the Lore API: request timed out (15s)",
    );
  });
});

describe("lore_get_analytics", () => {
  it("returns the API's analytics object as pretty-printed JSON", async () => {
    const analytics = {
      period: "month",
      usage: { llm_calls: 12, input_tokens: 900, output_tokens: 300 },
      tasks: { total: 10, succeeded: 7, failed: 2 },
      by_type: [{ task_type: "implementation", tasks: "6" }],
    };

    proxy.mockResolvedValue({ ok: true, body: JSON.stringify(analytics) });

    expect(
      text(await handlers()["lore_get_analytics"]({ period: "month" })),
    ).toBe(JSON.stringify(analytics, null, 2));
  });

  it("passes the requested period through to /api/analytics", async () => {
    proxy.mockResolvedValue({ ok: true, body: "{}" });
    await handlers()["lore_get_analytics"]({ period: "today" });

    expect(proxy).toHaveBeenCalledWith("/api/analytics?period=today");
  });

  it("reports a missing API configuration instead of a PostgreSQL message", async () => {
    proxy.mockResolvedValue({ ok: false, reason: "not_configured" });

    expect(text(await handlers()["lore_get_analytics"]({}))).toContain(
      "Lore API not configured for fetching analytics",
    );
  });

  it("surfaces the failure detail when the API is unreachable", async () => {
    proxy.mockResolvedValue({
      ok: false,
      reason: "unreachable",
      detail: "HTTP 500 Internal Server Error",
    });

    expect(text(await handlers()["lore_get_analytics"]({}))).toBe(
      "Could not fetch analytics from the Lore API: HTTP 500 Internal Server Error",
    );
  });
});
