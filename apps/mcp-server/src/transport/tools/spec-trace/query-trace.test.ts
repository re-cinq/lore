import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("../shared/deps.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/deps.js")>()),
  proxyGetApi: vi.fn(),
}));

import { proxyGetApi } from "../shared/deps.js";
import { registerQueryTraceTool } from "./query-trace.js";
import { toolHandlers } from "../shared/tool-test-helpers.js";

const proxy = vi.mocked(proxyGetApi);
const queryTrace = toolHandlers(registerQueryTraceTool, "agent")[
  "lore-query-trace"
];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("lore-query-trace", () => {
  it("reads the document of spec specs/auth/spec.md through the read cache path", async () => {
    vi.stubEnv("LORE_CACHE_ENABLED", "false");
    proxy.mockResolvedValue({ ok: false, reason: "not_configured" });

    await queryTrace({ repo: "re-cinq/lore", spec: "specs/auth/spec.md" });

    expect(proxy.mock.calls).toEqual([
      ["/api/repos/re-cinq/lore/trace/document?path=specs%2Fauth%2Fspec.md"],
    ]);
  });

  it("asks for the tests covering src/auth/token.ts live", async () => {
    proxy.mockResolvedValue({ ok: false, reason: "not_configured" });

    await queryTrace({
      repo: "re-cinq/lore",
      tests_covering: "src/auth/token.ts",
    });

    expect(proxy.mock.calls[0][0]).toMatch(
      /^\/api\/repos\/re-cinq\/lore\/trace\/tests-covering\?/,
    );
  });

  it("asks for the failures touching src/auth/token.ts live", async () => {
    proxy.mockResolvedValue({ ok: false, reason: "not_configured" });

    await queryTrace({
      repo: "re-cinq/lore",
      failures_touching: "src/auth/token.ts",
    });

    expect(proxy.mock.calls[0][0]).toBe(
      "/api/repos/re-cinq/lore/trace/failures-touching?path=src%2Fauth%2Ftoken.ts",
    );
  });

  it("answers the callers of runQueryTrace with the API's body", async () => {
    vi.stubEnv("LORE_CACHE_ENABLED", "false");
    proxy.mockResolvedValue({ ok: true, body: "runQueryTrace <- queryTrace" });

    const result = await queryTrace({
      repo: "re-cinq/lore",
      callers_of: "runQueryTrace",
    });

    expect(result.content[0].text).toBe("runQueryTrace <- queryTrace");
  });

  it("refuses a call with no repo in the agent gateway", async () => {
    const result = await queryTrace({ spec: "specs/auth/spec.md" });

    expect({
      text: result.content[0].text,
      proxied: proxy.mock.calls.length,
    }).toEqual({
      text: "No repo given. Pass repo as owner/name (e.g. 're-cinq/lore'): the shared Lore server has no checkout to detect it from.",
      proxied: 0,
    });
  });
});
