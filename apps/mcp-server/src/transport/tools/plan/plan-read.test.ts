import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { registerPlanReadTool } from "./plan-read.js";

const fetchMock = vi.fn();
const planRead = toolHandlers(registerPlanReadTool, "full")["lore_plan_read"];
const planId = "b4b2026f-1111-2222-3333-444455556666";

describe("lore_plan_read", () => {
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

  it("returns the agent view read from GET /api/plans/:id/agent-view with the bearer token", async () => {
    const view = { sections: [{ id: "s1", heading: "Goals" }] };

    fetchMock.mockResolvedValue({ ok: true, json: async () => view });

    const result = await planRead({ plan_id: planId });

    expect({
      answer: JSON.parse(result.content[0].text),
      call: fetchMock.mock.calls[0],
    }).toMatchObject({
      answer: view,
      call: [
        `https://lore-api.example.com/api/plans/${planId}/agent-view`,
        { headers: { Authorization: "Bearer tok" } },
      ],
    });
  });

  it("asks for a configured LORE_API_URL when the env is unset", async () => {
    vi.stubEnv("LORE_API_URL", "");

    expect((await planRead({ plan_id: planId })).content[0].text).toBe(
      "Reading a plan requires a configured LORE_API_URL.",
    );
  });

  it("reports a denied token on a 403", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    });

    expect((await planRead({ plan_id: planId })).content[0].text).toContain(
      "denied access for lore_plan_read",
    );
  });
});
