import { describe, it, expect } from "vitest";
import { loadTemplates, assembleContext } from "./context-assembly.js";
import { join } from "node:path";
import { docStatementItems } from "@re-cinq/lore-shared/utopia/doc-statements.js";
import { wireBody } from "@re-cinq/lore-shared/utopia/statements.js";
import type { SearchHit } from "@re-cinq/lore-shared/utopia/read-shapes.js";
import type { UtopiaReads } from "@re-cinq/lore-shared/utopia/utopia-reads.js";

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
    expect(estimateTokens("hello world")).toBe(3);
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

    const result = truncateToTokens(text, 100);

    expect(result).toContain("First paragraph");
    expect(result).toContain("...(truncated)");
    expect(result.length).toBeLessThan(text.length);
  });
});

describe("loadTemplates", () => {
  it("loads templates from the templates directory", () => {
    const templateDir = join(
      import.meta.dirname,
      "..",
      "..",
      "..",
      "templates",
    );

    loadTemplates(templateDir);
  });
});

describe("assembleContext", () => {
  it("returns empty text when no sources return data", async () => {
    const mockPool = {
      query: async () => ({ rows: [] }),
    };

    const result = await assembleContext(
      mockPool as unknown as Parameters<typeof assembleContext>[0],
      "test query",
      {
        templateName: "default",
        maxTokens: 8000,
      },
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
      {
        templateName: "default",
        maxTokens: 8000,
        repo: "owner/repo",
      },
    );

    expect(result.text).toContain("Conventions");
    expect(result.text).toContain("CLAUDE.md content here");
    expect(result.sections.length).toBeGreaterThan(0);
  });

  it("respects token budget", async () => {
    const longContent = "x".repeat(100000);
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
      {
        templateName: "default",
        maxTokens: 2000,
        repo: "owner/repo",
      },
    );
    const totalChars = result.text.length;

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
      {
        templateName: "implementation",
        maxTokens: 8000,
        repo: "o/r",
      },
    );

    expect(result.text).toContain('<context query="dark factory"');
    expect(result.text).toContain(
      '<document source="adrs/ADR-016.md" type="adr" relevance="1.00"',
    );
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
      {
        templateName: "implementation",
        maxTokens: 8000,
        repo: "o/r",
      },
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

    await assembleContext(
      mockPool as unknown as Parameters<typeof assembleContext>[0],
      "x",
      {
        templateName: "implementation",
        maxTokens: 8000,
        repo: "o/r",
      },
    );
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
      {
        templateName: "implementation",
        maxTokens: 8000,
        repo: "o/r",
      },
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
      {
        templateName: "implementation",
        maxTokens: 8000,
        repo: "o/r",
        crossRepo: false,
        includeIds: false,
        debug: true,
      },
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

  it("writes nothing to the database when the default template is assembled passively", async () => {
    const written: string[] = [];
    const recordingPool = {
      query: async (sql: string) => {
        if (/^\s*(UPDATE|INSERT)/.test(sql)) {
          written.push(sql);
        }

        return { rows: [] };
      },
    };

    await assembleContext(
      recordingPool as unknown as Parameters<typeof assembleContext>[0],
      "how are webhooks verified",
      { repo: "o/r", passive: true },
    );

    expect(written).toEqual([]);
  });

  it("audits its memory searches when the default template is assembled for an agent", async () => {
    const written: string[] = [];
    const recordingPool = {
      query: async (sql: string) => {
        if (/^\s*(UPDATE|INSERT)/.test(sql)) {
          written.push(sql);
        }

        return { rows: [] };
      },
    };

    await assembleContext(
      recordingPool as unknown as Parameters<typeof assembleContext>[0],
      "how are webhooks verified",
      { repo: "o/r" },
    );

    expect(written.length).toBeGreaterThan(0);
  });
});

describe("assembleContext — linked repos on the shipped templates", () => {
  const templates = ["default", "implementation", "review"];

  function poolWith(links: string[]) {
    const queries: string[] = [];

    return {
      queries,
      pool: {
        query: async (sql: string) => {
          queries.push(sql);

          if (sql.includes("SELECT settings")) {
            return { rows: [{ settings: { cross_repo_repos: links } }] };
          }

          return { rows: [] };
        },
      } as unknown as Parameters<typeof assembleContext>[0],
    };
  }

  it.each(templates)(
    "%s carries a cross_repo trace section when crossRepo is requested",
    async (templateName) => {
      const { pool } = poolWith(["octo/linked"]);
      const result = await assembleContext(pool, "x", {
        templateName,
        repo: "o/r",
        crossRepo: true,
        debug: true,
      });

      expect(
        result.trace?.sections.find((s) => s.source === "cross_repo"),
      ).toMatchObject({ header: "Linked Repos", status: "empty" });
    },
  );

  it.each(templates)(
    "%s marks cross_repo disabled and never searches chunks without linked repos",
    async (templateName) => {
      const { pool, queries } = poolWith([]);
      const result = await assembleContext(pool, "x", {
        templateName,
        repo: "o/r",
        crossRepo: true,
        debug: true,
      });
      const section = result.trace?.sections.find(
        (s) => s.source === "cross_repo",
      );

      expect(section?.status).toBe("disabled");
      expect(queries.some((q) => q.includes("repo !="))).toBe(false);
    },
  );
});

describe("assembleContext — backend", () => {
  const conventionsPool = (queries: string[]) =>
    ({
      query: async (sql: string, params: unknown[]) => {
        queries.push(sql);
        const contentTypes = params?.find(Array.isArray) as
          string[] | undefined;

        return sql.includes("org_shared.chunks") &&
          contentTypes?.includes("doc")
          ? {
              rows: [
                {
                  content: "Deploy on Friday",
                  file_path: "CLAUDE.md",
                  content_type: "doc",
                },
              ],
            }
          : { rows: [] };
      },
    }) as unknown as Parameters<typeof assembleContext>[0];

  it("returns a no-Utopia-reader section for each default source and reads nothing from Lore for backend utopia", async () => {
    const queries: string[] = [];
    const result = await assembleContext(conventionsPool(queries), "deploys", {
      templateName: "default",
      repo: "owner/repo",
      backend: "utopia",
    });

    expect({
      queries: queries.length,
      headers: result.sections.map((section) => section.header),
      conventions: result.text.includes("repo: no Utopia reader yet"),
      loreData: result.text.includes("Deploy on Friday"),
    }).toEqual({
      queries: 0,
      headers: [
        "Directory Rules",
        "Conventions",
        "Relevant Code",
        "Architecture Decisions",
        "Agent Memory",
        "Related Entities",
        "Recent Episodes",
        "Recent Incidents",
      ],
      conventions: true,
      loreData: false,
    });
  });

  it("returns Lore's block then Utopia's, each on 4000 of an 8000-token budget, for backend both", async () => {
    const result = await assembleContext(conventionsPool([]), "deploys", {
      templateName: "default",
      maxTokens: 8000,
      repo: "owner/repo",
      backend: "both",
    });
    const lore = result.text.indexOf('<backend name="lore">');
    const utopia = result.text.indexOf('<backend name="utopia">');

    expect({
      loreFirst: lore >= 0 && lore < utopia,
      budgets: result.text.match(/budget="\d+"/g),
      loreConventions: result.sections[0]?.header,
      utopiaConventions: result.sections.some(
        (section) => section.header === "utopia: Conventions",
      ),
    }).toEqual({
      loreFirst: true,
      budgets: ['budget="4000"', 'budget="4000"'],
      loreConventions: "lore: Conventions",
      utopiaConventions: true,
    });
  });
});

describe("assembleContext — the Utopia arm", () => {
  const STATEMENTS = "9e8d7c6b-5a49-4382-b1a0-f9e8d7c6b533";
  const ADR = "adrs/ADR-052-code-to-spec-graph-mirrored-in-utopia.md";
  const SPEC = "specs/utopia-graph-mirror/spec.md";
  const pushed = [
    ...docStatementItems({
      repo: "re-cinq/lore",
      path: ADR,
      commit: "fb53a29",
      kind: "adr",
      content:
        "# ADR-052: Code-to-spec graph mirrored in Utopia\n\nEvery spec and ADR is pushed to Utopia.\n\nA failed mirror is logged, never an ingest failure.\n",
    }),
    ...docStatementItems({
      repo: "re-cinq/lore",
      path: SPEC,
      commit: "fb53a29",
      kind: "spec",
      content: "# Utopia graph mirror\n\nA 404 reads as no document.\n",
    }),
  ];
  const chunkTexts = new Map(
    pushed.map((statementsItem) => [
      statementsItem.externalId,
      JSON.stringify(wireBody(statementsItem), null, 2),
    ]),
  );
  const hits: SearchHit[] = [
    `stmt:${ADR}#0001`,
    `stmt:${SPEC}#0000`,
    `stmt:${ADR}#0000`,
  ].map((externalId, rank) => ({
    chunkId: `chunk-${rank}`,
    documentId: `document-${rank}`,
    seq: 0,
    text: chunkTexts.get(externalId) ?? "",
    filename: externalId,
    sourceId: STATEMENTS,
    externalId,
    score: 0.03 - rank * 0.001,
    bm25Rank: rank + 1,
    vectorRank: rank + 1,
  }));
  const reads: UtopiaReads = {
    search: async () => ({ hits, hasMore: false, vectorUsed: true }),
    documentByExternalId: async () => null,
  };
  const untouchedPool = (queries: string[]) =>
    ({
      query: async (sql: string) => {
        queries.push(sql);

        return { rows: [] };
      },
    }) as unknown as Parameters<typeof assembleContext>[0];
  const utopiaOptions = {
    templateName: "default",
    repo: "re-cinq/lore",
    backend: "utopia" as const,
    utopiaReads: reads,
    utopiaMirror: { kbId: "kb-1", statementsSourceId: STATEMENTS },
  };

  it("returns the ADR under Architecture Decisions with its statement texts when search answers its stmt chunks", async () => {
    const queries: string[] = [];
    const result = await assembleContext(
      untouchedPool(queries),
      "how is a failed mirror handled",
      utopiaOptions,
    );
    const decisions = result.text.slice(
      result.text.indexOf('<section name="Architecture Decisions"'),
    );

    expect({
      queries: queries.length,
      adr: decisions.includes(`source="${ADR}" type="adr"`),
      texts: decisions.includes(
        "Every spec and ADR is pushed to Utopia.\nA failed mirror is logged, never an ingest failure.",
      ),
      code: result.text.includes("code: no Utopia reader yet"),
    }).toEqual({ queries: 0, adr: true, texts: true, code: true });
  });

  it("records a trace whose sections list the kept source paths", async () => {
    const result = await assembleContext(untouchedPool([]), "mirror", {
      ...utopiaOptions,
      debug: true,
    });
    const keptPaths = Object.fromEntries(
      (result.trace?.sections ?? [])
        .filter(
          (section) => section.source === "repo" || section.source === "adrs",
        )
        .map((section) => [
          section.source,
          section.items.map((kept) => kept.source_path),
        ]),
    );

    expect(keptPaths).toEqual({ repo: [SPEC], adrs: [ADR] });
  });

  it("falls back to no-reader sections when the repo has no Utopia settings", async () => {
    const searched: string[] = [];
    const result = await assembleContext(untouchedPool([]), "mirror", {
      ...utopiaOptions,
      utopiaMirror: undefined,
      utopiaReads: {
        ...reads,
        search: async (kbId, q, window) => {
          searched.push(q);

          return reads.search(kbId, q, window);
        },
      },
    });

    expect({
      searched,
      conventions: result.text.includes("repo: no Utopia reader yet"),
      decisions: result.text.includes("adrs: no Utopia reader yet"),
    }).toEqual({ searched: [], conventions: true, decisions: true });
  });
});
