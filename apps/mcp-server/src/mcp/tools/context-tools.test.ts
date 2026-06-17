import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { store } from "../../platform/proxy-cache.js";

// The handler captures `CONTEXT_PATH` from the environment at module load,
// and with no pg pool configured `isDbAvailable()` is false, so lore_search_context
// takes the file-based fallback over real .md files on disk. We point
// CONTEXT_PATH at a real temp tree and drive the actual registered handler —
// no logic is mocked.

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
}>;

const contextRoot = mkdtempSync(join(tmpdir(), "lore-search-context-"));
let searchContext: ToolHandler;
let assembleContext: ToolHandler;

beforeAll(async () => {
  writeFileSync(
    join(contextRoot, "conventions.md"),
    "# Conventions\n\nWe deploy on Friday afternoons.\n\nUnrelated paragraph about cats.",
  );
  mkdirSync(join(contextRoot, "teams", "payments"), { recursive: true });
  writeFileSync(
    join(contextRoot, "teams", "payments", "rules.md"),
    "Payments uses idempotency keys.\n\nDeploy on Friday afternoons too.",
  );

  process.env.CONTEXT_PATH = contextRoot;
  const { registerContextTools } = await import("./context-tools.js");

  const handlers: Record<string, ToolHandler> = {};
  const fakeServer = {
    tool(name: string, _desc: string, _schema: unknown, handler: ToolHandler) {
      handlers[name] = handler;
    },
  };
  registerContextTools(fakeServer as never, { getPool: () => null });
  searchContext = handlers["lore_search_context"];
  assembleContext = handlers["lore_assemble_context"];
});

afterAll(() => {
  rmSync(contextRoot, { recursive: true, force: true });
  delete process.env.CONTEXT_PATH;
});

describe("lore_search_context file-based fallback", () => {
  it("returns the matching paragraph with its source path", async () => {
    const result = await searchContext({ query: "Friday afternoons", limit: 8 });
    const text = result.content[0].text;
    expect(text).toContain("**Source:** conventions.md");
    expect(text).toContain("We deploy on Friday afternoons.");
  });

  it("matches case-insensitively", async () => {
    const result = await searchContext({ query: "FRIDAY AFTERNOONS", limit: 8 });
    expect(result.content[0].text).toContain("We deploy on Friday afternoons.");
  });

  it("excludes paragraphs that do not contain the query", async () => {
    const result = await searchContext({ query: "deploy", limit: 8 });
    expect(result.content[0].text).not.toContain("Unrelated paragraph about cats");
  });

  it("returns a no-results message when nothing matches", async () => {
    const result = await searchContext({ query: "nonexistent-term-xyz", limit: 8 });
    expect(result.content[0].text).toEqual(
      'No results found for "nonexistent-term-xyz".',
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
});

describe("lore_assemble_context proxy path (read-through cache)", () => {
  let cacheDir: string;
  const policy = {
    tool: "lore_assemble_context",
    args: { query: "q", template: "default", repo: "owner/r" },
    repo: "owner/r",
    ttlSeconds: 0,
  };

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "lore-assemble-cache-"));
    process.env.LORE_CACHE_DIR = cacheDir;
    process.env.LORE_API_URL = "https://lore.example";
    process.env.LORE_INGEST_TOKEN = "test-token";
    delete process.env.LORE_CACHE_ENABLED; // enable the cache (global setup disables it)
    delete process.env.LORE_DB_HOST;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(cacheDir, { recursive: true, force: true });
    delete process.env.LORE_CACHE_DIR;
    delete process.env.LORE_API_URL;
    delete process.env.LORE_INGEST_TOKEN;
    delete process.env.LORE_CACHE_ENABLED;
  });

  it("returns an empty-but-reachable context as-is instead of a stale cached copy", async () => {
    store(policy, "OLD CONTEXT");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ text: "" }) })));
    const result = await assembleContext({ query: "q", template: "default", repo: "owner/r" });
    expect(result.content[0].text).toBe("");
  });

  it("does not serve a stale cached copy when the backend denies access (403)", async () => {
    store(policy, "OLD CONTEXT");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, statusText: "Forbidden", json: async () => ({}) })));
    const result = await assembleContext({ query: "q", template: "default", repo: "owner/r" });
    expect(result.content[0].text).not.toContain("OLD CONTEXT");
    expect(result.content[0].text).toContain("denied access");
  });

  it("returns the live result on a reachable hit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ text: "FRESH CONTEXT" }) })));
    const result = await assembleContext({ query: "q2", template: "default", repo: "owner/r" });
    expect(result.content[0].text).toBe("FRESH CONTEXT");
  });
});
