import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
