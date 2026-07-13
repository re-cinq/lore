import { describe, it, expect } from "vitest";
import { loadTemplates, assembleContext } from "./context-assembly.js";
import { join } from "node:path";

// ── Token estimation ────────────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;

  if (text.length <= maxChars) {
    return text;
  }
  const truncated = text.substring(0, maxChars);
  const lastParagraph = truncated.lastIndexOf("\n\n");

  if (lastParagraph > maxChars * 0.5) {
    return truncated.substring(0, lastParagraph) + "\n\n...(truncated)";
  }

  return truncated + "\n\n...(truncated)";
}

describe("token estimation", () => {
  it("estimates ~4 chars per token", () => {
    expect(estimateTokens("hello world")).toBe(3); // 11 chars / 4 = 2.75 -> 3
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});

describe("truncateToTokens", () => {
  it("returns text unchanged when under budget", () => {
    const text = "short text";

    expect(truncateToTokens(text, 100)).toBe(text);
  });

  it("truncates long text at paragraph boundary", () => {
    const paragraph1 = "First paragraph. ".repeat(20);
    const paragraph2 = "Second paragraph. ".repeat(20);
    const text = `${paragraph1}\n\n${paragraph2}`;

    const result = truncateToTokens(text, 100); // ~400 chars

    expect(result).toContain("First paragraph");
    expect(result).toContain("...(truncated)");
    expect(result.length).toBeLessThan(text.length);
  });
});

// ── Template loading ────────────────────────────────────────────────

describe("loadTemplates", () => {
  it("loads templates from the templates directory", () => {
    const templateDir = join(
      import.meta.dirname,
      "..",
      "..",
      "..",
      "templates",
    );

    // This should not throw
    loadTemplates(templateDir);
  });
});

// ── assembleContext with mock pool ──────────────────────────────────

describe("assembleContext", () => {
  it("returns empty text when no sources return data", async () => {
    const mockPool = {
      query: async () => ({ rows: [] }),
    };

    const result = await assembleContext(
      mockPool as unknown as Parameters<typeof assembleContext>[0],
      "test query",
      "default",
      8000,
    );

    expect(result.text).toBe("");
    expect(result.sections).toEqual([]);
  });

  it("assembles context from repo source", async () => {
    const mockPool = {
      query: async (sql: string, params: any[]) => {
        const ct = params?.find(Array.isArray) as string[] | undefined;

        if (sql.includes("org_shared.chunks") && ct?.includes("doc")) {
          return {
            rows: [
              {
                content: "CLAUDE.md content here",
                file_path: "CLAUDE.md",
                content_type: "doc",
              },
            ],
          };
        }

        return { rows: [] };
      },
    };

    const result = await assembleContext(
      mockPool as unknown as Parameters<typeof assembleContext>[0],
      "test query",
      "default",
      8000,
      "owner/repo",
    );

    expect(result.text).toContain("Conventions");
    expect(result.text).toContain("CLAUDE.md content here");
    expect(result.sections.length).toBeGreaterThan(0);
  });

  it("respects token budget", async () => {
    const longContent = "x".repeat(100000); // Way over any budget
    const mockPool = {
      query: async (sql: string) => {
        if (sql.includes("org_shared.chunks")) {
          return { rows: [{ content: longContent, file_path: "test.md" }] };
        }

        return { rows: [] };
      },
    };

    const result = await assembleContext(
      mockPool as unknown as Parameters<typeof assembleContext>[0],
      "test",
      "default",
      2000,
      "owner/repo",
    );
    const totalChars = result.text.length;

    // With 2000 token budget (~8000 chars), result should be under that
    expect(totalChars).toBeLessThan(10000);
    expect(result.sections.some((s) => s.truncated)).toBe(true);
  });
});

describe("assembleContext — traceable XML output", () => {
  it("emits XML-tagged documents carrying provenance, with markdown contained", async () => {
    const mockPool = {
      query: async (sql: string, params: any[]) => {
        const ct = params?.find(Array.isArray) as string[] | undefined;

        if (ct?.includes("adr")) {
          return {
            rows: [
              {
                content: "## Decision\n\nuse X",
                file_path: "adrs/ADR-016.md",
                content_type: "adr",
                score: 0.83,
              },
            ],
          };
        }

        return { rows: [] };
      },
    };
    const result = await assembleContext(
      mockPool as unknown as Parameters<typeof assembleContext>[0],
      "dark factory",
      "implementation",
      8000,
      "o/r",
    );

    expect(result.text).toContain('<context query="dark factory"');
    // Scores are normalized so the top (here, only) result is 1.00.
    expect(result.text).toContain(
      '<document source="adrs/ADR-016.md" type="adr" relevance="1.00"',
    );
    // The chunk's own `##` heading lives inside the tag, not colliding with the skeleton.
    expect(result.text).toContain("## Decision");
  });

  it("ranks ADRs by ts_rank against the query, not recency", async () => {
    let adrSql = "";
    const mockPool = {
      query: async (sql: string, params: any[]) => {
        const ct = params?.find(Array.isArray) as string[] | undefined;

        if (ct?.includes("adr")) {
          adrSql = sql;
        }

        return { rows: [] };
      },
    };

    await assembleContext(
      mockPool as unknown as Parameters<typeof assembleContext>[0],
      "auth middleware",
      "implementation",
      8000,
      "o/r",
    );
    expect(adrSql).toContain("ts_rank");
    expect(adrSql).toContain("websearch_to_tsquery");
  });

  it("requests doc + spec for the repo/Conventions source, not adr", async () => {
    let repoTypes: string[] | undefined;
    const mockPool = {
      query: async (sql: string, params: any[]) => {
        const ct = params?.find(Array.isArray) as string[] | undefined;

        if (sql.includes("org_shared.chunks") && ct?.includes("doc")) {
          repoTypes = ct;
        }

        return { rows: [] };
      },
    };

    await assembleContext(mockPool as unknown as Parameters<typeof assembleContext>[0], "x", "implementation", 8000, "o/r");
    expect(repoTypes).toEqual(["doc", "spec"]);
    expect(repoTypes).not.toContain("adr");
  });

  it("retrieves a dedicated code section for implementation tasks", async () => {
    let codeTypes: string[] | undefined;
    const mockPool = {
      query: async (sql: string, params: any[]) => {
        const ct = params?.find(Array.isArray) as string[] | undefined;

        if (sql.includes("org_shared.chunks") && ct?.includes("code")) {
          codeTypes = ct;

          return {
            rows: [
              {
                content: "export function parseSettingsForm() {}",
                file_path: "web-ui/src/lib/settings-form.ts",
                content_type: "code",
                score: 0.5,
              },
            ],
          };
        }

        return { rows: [] };
      },
    };
    const result = await assembleContext(
      mockPool as unknown as Parameters<typeof assembleContext>[0],
      "settings form",
      "implementation",
      8000,
      "o/r",
    );

    expect(codeTypes).toEqual(["code"]);
    expect(result.text).toContain("settings-form.ts");
    expect(result.text).toContain("parseSettingsForm");
  });

  it("debug trace reports per-section status and omit reason for empty sources", async () => {
    const mockPool = { query: async () => ({ rows: [] }) };
    const result = await assembleContext(
      mockPool as unknown as Parameters<typeof assembleContext>[0],
      "x",
      "implementation",
      8000,
      "o/r",
      undefined,
      false,
      false,
      true,
    );

    expect(result.trace).toBeDefined();
    expect(result.trace?.budget.total).toBe(8000);
    const adr = result.trace?.sections.find((s) => s.source === "adrs");

    expect(adr).toMatchObject({
      included: false,
      status: "empty",
      omitReason: "no results",
    });
  });
});
