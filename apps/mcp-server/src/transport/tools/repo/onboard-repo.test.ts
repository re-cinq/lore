import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("../shared/deps.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/deps.js")>()),
  proxyToApi: vi.fn(),
}));

import { proxyToApi } from "../shared/deps.js";
import { registerOnboardRepoTool } from "./onboard-repo.js";
import type { ServerMode } from "../shared/repo-scope.js";
import { toolHandlers } from "../shared/tool-test-helpers.js";

function handlerFor(name: string, mode: ServerMode = "full") {
  return toolHandlers(registerOnboardRepoTool, mode)[name];
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("lore_onboard_repo", () => {
  it("returns the guard's refusal body verbatim on a 409, not the unreachable-retry copy, since the caller needs task_id to poll", async () => {
    const body = JSON.stringify({
      blocked: "in-flight",
      error: "re-cinq/x is already in flight",
      task_id: "task-9",
    });

    vi.mocked(proxyToApi).mockResolvedValue({
      ok: false,
      reason: "unreachable",
      detail: "HTTP 409 Conflict: re-cinq/x is already in flight",
      status: 409,
      body,
    });
    const handler = handlerFor("lore_onboard_repo");
    const result = await handler({ full_name: "re-cinq/x" });

    expect(result.content[0].text).toBe(body);
  });

  it("still reports a genuine outage as unreachable", async () => {
    vi.mocked(proxyToApi).mockResolvedValue({
      ok: false,
      reason: "unreachable",
      detail: "request timed out (15s)",
    });
    const handler = handlerFor("lore_onboard_repo");
    const result = await handler({ full_name: "re-cinq/x" });

    expect(result.content[0].text).toContain("Lore API unreachable");
  });

  it("passes reonboard through to the API", async () => {
    vi.mocked(proxyToApi).mockResolvedValue({ ok: true, body: "{}" });
    const handler = handlerFor("lore_onboard_repo");

    await handler({ full_name: "re-cinq/x", reonboard: true });

    expect(proxyToApi).toHaveBeenCalledWith("/api/onboard", {
      repo: "re-cinq/x",
      reonboard: true,
    });
  });
});
