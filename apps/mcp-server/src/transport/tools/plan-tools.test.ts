import {
  describe,
  it,
  expect,
  beforeAll,
  afterEach,
  beforeEach,
  vi,
} from "vitest";

type ToolHandler = (
  args: Record<string, unknown>,
) => Promise<{ content: { type: string; text: string }[] }>;

let planRead: ToolHandler;
let planEdit: ToolHandler;
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
  planEdit = handlers["lore_plan_edit"];
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

describe("lore_plan_edit remote proxy", () => {
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

  it("posts the op and expect to /api/plans/:id/agent-edits with the bearer token", async () => {
    const planId = "b4b2026f-1111-2222-3333-444455556666";
    const op = {
      op: "append-to-section",
      slot: "intent",
      paragraphs: ["Checkout is slow."],
    };
    const expectHash = { blockId: "p-1", hash: "abc" };
    const applied = { ok: true };

    fetchMock.mockResolvedValue({ ok: true, json: async () => applied });

    const result = await planEdit({ plan_id: planId, op, expect: expectHash });
    const [calledUrl, opts] = fetchMock.mock.calls[0];

    expect({
      calledUrl,
      authorization: (opts as any).headers.Authorization,
      body: JSON.parse((opts as any).body),
      answer: JSON.parse(result.content[0].text),
    }).toEqual({
      calledUrl: `https://lore-api.example.com/api/plans/${planId}/agent-edits`,
      authorization: "Bearer tok",
      body: { actor: "planning-agent", ops: [op], expect: expectHash },
      answer: applied,
    });
  });

  it("tells the agent to reread and retry when the block changed under it", async () => {
    const planId = "b4b2026f-1111-2222-3333-444455556666";
    const op = { op: "replace-block", blockId: "p-1", text: "new" };
    const expectHash = { blockId: "p-1", hash: "abc" };
    const problem = {
      type: "https://lore.dev/problems/plan-block-conflict",
      title: "Conflict",
      status: 409,
      detail: "block p-1 changed after the agent read it",
    };

    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      statusText: "Conflict",
      json: async () => problem,
      text: async () => JSON.stringify(problem),
    });

    const result = await planEdit({ plan_id: planId, op, expect: expectHash });

    expect(result.content[0].text).toEqual(
      "Edit refused: block p-1 changed after the agent read it. Read the plan again with lore_plan_read and retry against the block's current hash.",
    );
  });
});
