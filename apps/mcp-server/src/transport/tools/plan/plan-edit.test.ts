import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { registerPlanEditTool } from "./plan-edit.js";

const fetchMock = vi.fn();
const planEdit = toolHandlers(registerPlanEditTool, "full")["lore_plan_edit"];
const planId = "b4b2026f-1111-2222-3333-444455556666";
const replaceOp = { op: "replace-block", blockId: "p-1", text: "new" };
const textOf = async (args: Record<string, unknown>) =>
  (await planEdit(args)).content[0].text;
const answer409 = (body: string) =>
  fetchMock.mockResolvedValue({
    ok: false,
    status: 409,
    statusText: "Conflict",
    text: async () => body,
  });

describe("lore_plan_edit", () => {
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

  it("posts the op and expect as the planning agent to /api/plans/:id/agent-edits with the bearer token", async () => {
    const op = {
      op: "append-to-section",
      slot: "intent",
      paragraphs: ["Checkout is slow."],
    };
    const expectHash = { blockId: "p-1", hash: "abc" };

    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });

    const text = await textOf({ plan_id: planId, op, expect: expectHash });
    const [calledUrl, opts] = fetchMock.mock.calls[0] as [
      string,
      { headers: Record<string, string>; body: string },
    ];

    expect({
      calledUrl,
      authorization: opts.headers.Authorization,
      body: JSON.parse(opts.body),
      answer: JSON.parse(text),
    }).toEqual({
      calledUrl: `https://lore-api.example.com/api/plans/${planId}/agent-edits`,
      authorization: "Bearer tok",
      body: { actor: "planning-agent", ops: [op], expect: expectHash },
      answer: { ok: true },
    });
  });

  it("posts only the edit, leaving the agent's presence to lore-api", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    await textOf({ plan_id: planId, op: replaceOp });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `https://lore-api.example.com/api/plans/${planId}/agent-edits`,
    ]);
  });

  it("tells the agent to reread and retry when block p-1 changed under it", async () => {
    answer409(
      JSON.stringify({
        title: "Conflict",
        status: 409,
        detail: "block p-1 changed after the agent read it",
      }),
    );

    expect(await textOf({ plan_id: planId, op: replaceOp })).toBe(
      "Edit refused: block p-1 changed after the agent read it. Read the plan again with lore_plan_read and retry against the block's current hash.",
    );
  });

  it.each([
    ["an empty body", ""],
    ["a body that is not JSON", "<html>"],
    ["a problem body with no detail", JSON.stringify({ title: "Conflict" })],
  ])("reports a 409 with %s as a refused proxy call", async (_, body) => {
    answer409(body);

    expect(await textOf({ plan_id: planId, op: replaceOp })).not.toMatch(
      /^Edit refused/,
    );
  });

  it("reports a non-conflict 422 as a proxy error, not a refusal", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      statusText: "Unprocessable Entity",
      text: async () => JSON.stringify({ detail: "bad op" }),
    });

    expect(await textOf({ plan_id: planId, op: replaceOp })).not.toMatch(
      /^Edit refused/,
    );
  });

  it("asks for a configured LORE_API_URL when the env is unset", async () => {
    vi.stubEnv("LORE_API_URL", "");

    expect(await textOf({ plan_id: planId, op: replaceOp })).toBe(
      "Editing a plan requires a configured LORE_API_URL.",
    );
  });
});
