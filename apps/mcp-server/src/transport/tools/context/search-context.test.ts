import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resetRepoCache } from "@re-cinq/lore-server-core/features/repo/repo-detect.js";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { registerSearchContextTool } from "./search-context.js";

const outsideAnyCheckout = mkdtempSync(`${tmpdir()}/lore-search-context-`);

const searchContext = toolHandlers(registerSearchContextTool, "full")[
  "lore_search_context"
];
const searchInGateway = toolHandlers(registerSearchContextTool, "agent")[
  "lore_search_context"
];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("lore_search_context with no Lore API configured", () => {
  beforeEach(() => {
    vi.stubEnv("LORE_API_URL", "");
  });

  it("says the corpus search needs LORE_API_URL instead of scanning local files", async () => {
    const result = await searchContext({
      query: "Friday afternoons",
      limit: 8,
    });

    expect(result.content[0].text).toMatch(
      /searching the context corpus.*LORE_API_URL/s,
    );
  });
});

describe("lore_search_context through the API", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv("LORE_API_URL", "https://lore.example");
    vi.stubEnv("LORE_INGEST_TOKEN", "test-token");
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("gives the API 45s per attempt", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    });
    await searchContext({
      query: "timeout probe search",
      limit: 8,
      repo: "owner/repo",
    });

    expect(timeoutSpy).toHaveBeenCalledWith(45_000);
  });

  it("forwards backend=both to GET /api/search-context and prints the API's no-reader note after the passages", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{ content: "deploy on Friday", score: 0.5 }],
        notes: ["search_context: no Utopia reader yet"],
      }),
    });

    const result = await searchContext({
      query: "deploys",
      limit: 8,
      backend: "both",
      repo: "owner/r",
    });

    expect({
      url: String(fetchMock.mock.calls[0]?.[0]),
      text: result.content[0].text,
    }).toEqual({
      url: "https://lore.example/api/search-context?query=deploys&limit=8&backend=both&repo=owner%2Fr",
      text: "**Score:** 0.500\n\ndeploy on Friday\n\nsearch_context: no Utopia reader yet",
    });
  });

  it("forwards repo=owner/r and team payments to GET /api/search-context for the default backend", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{ content: "deploy on Friday", score: 1 }],
      }),
    });

    await searchContext({
      query: "deploys",
      team: "payments",
      limit: 8,
      repo: "owner/r",
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://lore.example/api/search-context?query=deploys&limit=8&team=payments&repo=owner%2Fr",
    );
  });

  it("says no results for deploys when the API matches nothing", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    });

    const result = await searchContext({
      query: "deploys",
      limit: 8,
      repo: "owner/r",
    });

    expect(result.content[0].text).toBe('No results for "deploys".');
  });

  it("logs the repo it detected from the checkout when the call names no team", async () => {
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    });
    await searchContext({ query: "deploys", limit: 8 });

    expect(logSpy.mock.calls.flat().join("\n")).toMatch(
      /lore_search_context: auto-detected repo \S+\/\S+/,
    );
  });

  it("sends no repo from a directory outside any checkout", async () => {
    const checkout = process.cwd();

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    });
    process.chdir(outsideAnyCheckout);
    resetRepoCache();

    try {
      await searchContext({ query: "deploys", limit: 8 });
    } finally {
      process.chdir(checkout);
      resetRepoCache();
    }

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://lore.example/api/search-context?query=deploys&limit=8",
    );
  });

  it("refuses repo 'not a repo' before asking the API", async () => {
    const result = await searchContext({
      query: "deploys",
      limit: 8,
      repo: "not a repo",
    });

    expect({
      text: result.content[0]?.text,
      proxied: fetchMock.mock.calls.length,
    }).toEqual({
      text: "Invalid repo 'not a repo'. Pass repo as owner/name (e.g. 're-cinq/lore').",
      proxied: 0,
    });
  });

  it("asks the agent gateway's caller for the repo when the call names none", async () => {
    const result = await searchInGateway({ query: "deploys", limit: 8 });

    expect(result.content[0].text).toBe(
      "No repo given. Pass repo as owner/name (e.g. 're-cinq/lore'): the shared Lore server has no checkout to detect it from.",
    );
  });
});
