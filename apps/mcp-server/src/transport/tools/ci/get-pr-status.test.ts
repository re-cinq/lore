import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("../shared/deps.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/deps.js")>()),
  proxyGetApi: vi.fn(),
}));

import { deniedError, proxyGetApi, unconfiguredError } from "../shared/deps.js";
import { registerGetPrStatusTool } from "./get-pr-status.js";
import type { ServerMode } from "../shared/repo-scope.js";
import { toolHandlers } from "../shared/tool-test-helpers.js";

function handlerFor(name: string, mode: ServerMode = "full") {
  return toolHandlers(registerGetPrStatusTool, mode)[name];
}

const proxy = vi.mocked(proxyGetApi);

afterEach(() => {
  vi.clearAllMocks();
});

describe("lore_get_pr_status", () => {
  it("is served beside the CI reads, so an agent pod can ask whether its pull request is green", async () => {
    proxy.mockResolvedValue({
      ok: true,
      body: JSON.stringify({ state: "open" }),
    });

    const result = await handlerFor("lore_get_pr_status")({
      repo: "re-cinq/lore",
      pr_number: 5,
    });

    expect({
      path: proxy.mock.calls[0][0],
      text: result.content[0].text,
    }).toEqual({
      path: "/api/pr-status?repo=re-cinq%2Flore&pr_number=5",
      text: JSON.stringify({ state: "open" }, null, 2),
    });
  });

  it("answers with the unconfigured copy when LORE_API_URL is not set", async () => {
    proxy.mockResolvedValue({ ok: false, reason: "not_configured" });

    const result = await handlerFor("lore_get_pr_status")({
      repo: "re-cinq/lore",
      pr_number: 5,
    });

    expect(result).toEqual(unconfiguredError("reading PR status"));
  });

  it("answers with the denied copy carrying the API's 'invalid token' detail", async () => {
    proxy.mockResolvedValue({
      ok: false,
      reason: "denied",
      detail: "invalid token",
    });

    const result = await handlerFor("lore_get_pr_status")({
      repo: "re-cinq/lore",
      pr_number: 5,
    });

    expect(result).toEqual(deniedError("lore_get_pr_status", "invalid token"));
  });

  it("reports the parse error when the API answers with a body that is not JSON", async () => {
    proxy.mockResolvedValue({ ok: true, body: "not json" });

    const result = await handlerFor("lore_get_pr_status")({
      repo: "re-cinq/lore",
      pr_number: 5,
    });

    expect(result.content[0].text).toMatch(/^Error reading PR status: /);
  });
});
