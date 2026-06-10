import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { triggerAgentSpecTrace } from "../routes.js";

describe("triggerAgentSpecTrace", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.LORE_AGENT_URL = "http://agent.internal:8080";
    process.env.LORE_AGENT_INTERNAL_TOKEN = "test-secret";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it("POSTs repo, kind, and payload to /api/trigger/spec-trace with the bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    globalThis.fetch = fetchMock as typeof fetch;
    await triggerAgentSpecTrace("re-cinq/lore", "test-report", { commit: "abc", tests: [], results: [] });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://agent.internal:8080/api/trigger/spec-trace");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-secret",
      },
    });
    expect(JSON.parse(init.body as string)).toEqual({
      repo: "re-cinq/lore",
      kind: "test-report",
      payload: { commit: "abc", tests: [], results: [] },
    });
  });
});
