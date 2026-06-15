import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { triggerAgentSpecCoverageValidate } from "../routes.js";

describe("triggerAgentSpecCoverageValidate", () => {
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

  it("POSTs the repo to /api/trigger/spec-coverage-validate with the bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    globalThis.fetch = fetchMock as typeof fetch;
    await triggerAgentSpecCoverageValidate("re-cinq/lore");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://agent.internal:8080/api/trigger/spec-coverage-validate");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-secret",
      },
    });
    expect(JSON.parse(init.body as string)).toEqual({ repo: "re-cinq/lore" });
  });

  it("strips a trailing slash on LORE_AGENT_URL so the path is well-formed", async () => {
    process.env.LORE_AGENT_URL = "http://agent.internal:8080/";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    globalThis.fetch = fetchMock as typeof fetch;
    await triggerAgentSpecCoverageValidate("o/r");
    expect(fetchMock.mock.calls[0][0]).toBe("http://agent.internal:8080/api/trigger/spec-coverage-validate");
  });

  it("skips the call entirely when LORE_AGENT_URL is missing", async () => {
    delete process.env.LORE_AGENT_URL;
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    await triggerAgentSpecCoverageValidate("o/r");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips the call entirely when LORE_AGENT_INTERNAL_TOKEN is missing", async () => {
    delete process.env.LORE_AGENT_INTERNAL_TOKEN;
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    await triggerAgentSpecCoverageValidate("o/r");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("swallows fetch errors so a flaky agent never breaks the ingest response", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as typeof fetch;
    await expect(triggerAgentSpecCoverageValidate("o/r")).resolves.toBeUndefined();
  });
});
