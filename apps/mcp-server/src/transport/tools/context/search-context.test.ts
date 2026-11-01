import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { resetRepoCache } from "@re-cinq/lore-server-core/features/repo/repo-detect.js";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { registerSearchContextTool } from "./search-context.js";

const contextRoot = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");

  process.env.CONTEXT_PATH = mkdtempSync(`${tmpdir()}/lore-search-context-`);

  return process.env.CONTEXT_PATH;
});

writeFileSync(
  join(contextRoot, "conventions.md"),
  "# Conventions\n\nWe deploy on Friday afternoons.\n\nUnrelated paragraph about cats.",
);
mkdirSync(join(contextRoot, "teams", "payments"), { recursive: true });
writeFileSync(
  join(contextRoot, "teams", "payments", "rules.md"),
  "Payments uses idempotency keys.\n\nDeploy on Friday afternoons too.",
);

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

describe("lore_search_context file-based fallback over real .md files on a temp CONTEXT_PATH tree (no mocking)", () => {
  beforeEach(() => {
    vi.stubEnv("LORE_API_URL", "");
  });

  it("returns the matching paragraph with its source path", async () => {
    const result = await searchContext({
      query: "Friday afternoons",
      limit: 8,
    });
    const text = result.content[0].text;

    expect(text).toContain("**Source:** conventions.md");
    expect(text).toContain("We deploy on Friday afternoons.");
  });

  it("matches case-insensitively", async () => {
    const result = await searchContext({
      query: "FRIDAY AFTERNOONS",
      limit: 8,
    });

    expect(result.content[0].text).toContain("We deploy on Friday afternoons.");
  });

  it("excludes paragraphs that do not contain the query", async () => {
    const result = await searchContext({ query: "deploy", limit: 8 });

    expect(result.content[0].text).not.toContain(
      "Unrelated paragraph about cats",
    );
  });

  it("says the offline scan is not the corpus when the local files match nothing", async () => {
    const result = await searchContext({
      query: "nonexistent-term-xyz",
      limit: 8,
    });

    expect(result.content[0].text).toEqual(
      'No results found for "nonexistent-term-xyz". This was a substring scan of local .md files under CONTEXT_PATH, not the ingested corpus — set LORE_API_URL to search it.',
    );
  });

  it("caps the number of returned paragraphs at the limit", async () => {
    const result = await searchContext({ query: "Friday", limit: 1 });
    const separators = result.content[0].text.split("\n\n---\n\n").length;

    expect(separators).toBe(1);
  });

  it("scopes the search to a team subtree when team is given", async () => {
    const result = await searchContext({
      query: "idempotency keys",
      team: "payments",
      limit: 8,
    });

    expect(result.content[0].text).toContain("Payments uses idempotency keys.");
  });

  it("returns a path-not-found error for an unknown team", async () => {
    const result = await searchContext({
      query: "anything",
      team: "does-not-exist",
      limit: 8,
    });

    expect(result.content[0].text).toMatch(/Error: search path not found at/);
  });

  it("skips a .md file it cannot read and still answers from the others", async () => {
    const locked = join(contextRoot, "teams", "locked");

    mkdirSync(locked, { recursive: true });
    writeFileSync(join(locked, "a-secret.md"), "Friday secret.");
    writeFileSync(join(locked, "b-open.md"), "Friday open.");
    chmodSync(join(locked, "a-secret.md"), 0o000);

    const result = await searchContext({
      query: "Friday",
      team: "locked",
      limit: 8,
    });

    expect(result.content[0].text).toBe(
      "**Source:** teams/locked/b-open.md\n\nFriday open.",
    );
  });

  it("refuses backend utopia instead of scanning local files", async () => {
    const result = await searchContext({
      query: "Friday afternoons",
      limit: 8,
      backend: "utopia",
    });

    expect(result.content[0].text).toBe(
      "backend utopia is answered by the Lore API only; set LORE_API_URL. The offline search reads Lore's stores alone.",
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
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

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
    process.chdir(contextRoot);
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
