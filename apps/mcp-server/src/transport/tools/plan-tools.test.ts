import { describe, it, expect, beforeAll, afterEach, beforeEach, vi } from "vitest";

type ToolHandler = (
  args: Record<string, unknown>,
) => Promise<{ content: { type: string; text: string }[] }>;

let planRead: ToolHandler;
const originalEnv = { ...process.env };
const fetchMock = vi.fn();

beforeAll(async () => {
  const { registerPlanTools } = await import("./plan-tools.js");
  const handlers: Record<string, ToolHandler> = {};
  const fakeServer = {
    tool(name: string, _desc: string, _schema: unknown, handler: ToolHandler) {
      handlers[name] = handler;
    },
  };

  registerPlanTools(fakeServer as never);
  planRead = handlers["lore_plan_read"];
});

describe("lore_plan_read remote proxy", () => {
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

  it("proxies to GET /api/plans/:id/agent-view with the bearer token", async () => {
    const planId = "b4b2026f-1111-2222-3333-444455556666";
    const view = { sections: [{ id: "s1", heading: "Goals" }] };

    fetchMock.mockResolvedValue({ ok: true, json: async () => view });

    const result = await planRead({ plan_id: planId });
    const [calledUrl, opts] = fetchMock.mock.calls[0];

    expect(calledUrl).toBe(
      `https://lore-api.example.com/api/plans/${planId}/agent-view`,
    );
    expect((opts as any).headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(result.content[0].text)).toEqual(view);
  });
});
