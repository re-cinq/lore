import { describe, it, expect, vi } from "vitest";

vi.mock("../../embeddings/embedding-service.js", () => ({
  getQueryEmbedding: vi.fn(async () => null),
}));

import { getQueryEmbedding } from "../../embeddings/embedding-service.js";
import {
  fitItemsToBudget,
  hybridChunkItems,
  extractKeyTerms,
  dropSeen,
  formatCouplingItems,
  fetchCouplingSource,
} from "./context-assembly.js";
import type { GraphContextBlock } from "../../spec-trace/graph-context.js";

describe("formatCouplingItems", () => {
  const block: GraphContextBlock = {
    statements: [
      {
        xid: "a#1",
        specPath: "specs/a/spec.md",
        specTitle: "A",
        section: "FR-2",
        statementText: "must do X",
        signal: "violated",
        adrs: [{ label: "ADR-016", path: "adrs/ADR-016.md" }],
        testSelectors: ["a.test.ts"],
      },
      {
        xid: "a#2",
        specPath: "specs/a/spec.md",
        specTitle: "A",
        statementText: "may do Y",
        signal: "untested",
        adrs: [],
        testSelectors: [],
      },
    ],
    adrRefs: ["adrs/ADR-016.md"],
    testSelectors: ["a.test.ts"],
    truncated: false,
  };

  it("formats each statement with its signal, ADRs, and tests; violated outscores untested", () => {
    const items = formatCouplingItems(block) as Array<{
      text: string;
      source_path?: string;
      score?: number;
    }>;

    expect(items).toHaveLength(2);
    expect(items[0].text).toContain("[violated]");
    expect(items[0].text).toContain("must do X");
    expect(items[0].text).toContain("ADR-016");
    expect(items[0].text).toContain("a.test.ts");
    expect(items[0].source_path).toBe("specs/a/spec.md");
    expect(items[0].score ?? 0).toBeGreaterThan(items[1].score ?? 0);
  });

  it("returns an empty list for an empty block", () => {
    expect(
      formatCouplingItems({
        statements: [],
        adrRefs: [],
        testSelectors: [],
        truncated: false,
      }),
    ).toEqual([]);
  });
});

describe("fetchCouplingSource", () => {
  it("returns disabled when no graph client is wired", async () => {
    expect(await fetchCouplingSource(null, "re-cinq/lore")).toEqual({
      items: [],
      status: "disabled",
    });
  });

  it("projects coupled statements from the graph into items", async () => {
    const port = {
      newTxn: () => ({
        queryWithVars: async () => ({
          data: {
            q: [
              {
                "Spec.file_path": "specs/a/spec.md",
                "Spec.title": "A",
                stmts: [
                  {
                    uid: "1",
                    "Statement.xid": "a#1",
                    "Statement.text": "must do X",
                    "Statement.violated": true,
                    db: [{ "ADR.file_path": "adrs/ADR-016.md" }],
                    vb: [{ "TestChunk.file_path": "a.test.ts" }],
                  },
                ],
              },
            ],
          },
        }),
        mutate: async () => ({}),
        discard: async () => ({}),
      }),
    };

    const res = await fetchCouplingSource(port as never, "re-cinq/lore");

    expect(res.status).toBe("ok");
    expect(res.items[0].text).toContain("must do X");
  });
});

describe("extractKeyTerms", () => {
  it("keeps distinctive terms and drops stopwords + short words", () => {
    const terms = extractKeyTerms(
      "add the UI controls for per-repo settings and parseSettingsForm",
    );

    expect(terms).toContain("controls");
    expect(terms).toContain("settings");
    expect(terms).toContain("parseSettingsForm");
    expect(terms).not.toContain("the");
    expect(terms).not.toContain("and");
    expect(terms).not.toContain("ui"); // 2 chars
  });

  it("de-duplicates and caps the number of terms", () => {
    const terms = extractKeyTerms("settings settings settings", 12);

    expect(terms).toEqual(["settings"]);
    expect(
      extractKeyTerms(
        Array.from({ length: 40 }, (_, i) => `term${i}`).join(" "),
        12,
      ).length,
    ).toBe(12);
  });
});

describe("dropSeen (cross-section dedup)", () => {
  const it_ = (path: string) => ({ text: path, tokens: 1, source_path: path });

  it("drops items already emitted in an earlier section, keeping the first", () => {
    const seen = new Set<string>();
    const first = dropSeen([it_("a"), it_("b")] as never, seen);
    const second = dropSeen([it_("b"), it_("c")] as never, seen);

    expect(
      (first as Array<{ source_path: string }>).map((i) => i.source_path),
    ).toEqual(["a", "b"]);
    expect(
      (second as Array<{ source_path: string }>).map((i) => i.source_path),
    ).toEqual(["c"]);
  });
});

const item = (tokens: number, path: string) => ({
  text: "x".repeat(tokens * 4),
  tokens,
  source_path: path,
});

describe("fitItemsToBudget per-document cap", () => {
  it("caps a single oversized document so smaller documents still fit", () => {
    const items = [item(1000, "big.md"), item(100, "a.md"), item(100, "b.md")];

    const { items: kept, truncated } = fitItemsToBudget(
      items as never,
      1000,
      400,
    );

    expect(
      (kept as Array<{ source_path: string }>).map((i) => i.source_path),
    ).toEqual(["big.md", "a.md", "b.md"]);
    expect(kept[0].tokens).toBeLessThanOrEqual(400);
    expect(truncated).toBe(true);
  });

  it("without a cap, one big document fills the budget and crowds out the rest", () => {
    const items = [item(1000, "big.md"), item(100, "a.md")];

    const { items: kept } = fitItemsToBudget(items as never, 1000);

    expect(
      (kept as Array<{ source_path: string }>).map((i) => i.source_path),
    ).toEqual(["big.md"]);
  });
});

describe("hybridChunkItems", () => {
  it("retrieves chunks bound to the repo + content types (keyword path when no embedding)", async () => {
    vi.mocked(getQueryEmbedding).mockResolvedValueOnce(null);
    const calls: Array<{ text: string; params?: unknown[] }> = [];
    const pool = {
      query: async <T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> => {
        calls.push({ text, params });

        return {
          rows: [
            {
              content: "export function parseSettingsForm() {}",
              file_path: "web-ui/src/lib/settings-form.ts",
              content_type: "code",
              score: 0.42,
            },
          ] as T[],
        };
      },
    };

    const items = await hybridChunkItems(
      pool,
      "settings form parser",
      "re-cinq/lore",
      ["code"],
      6,
    );

    expect(calls[0].params?.[0]).toBe("re-cinq/lore");
    expect(calls[0].params).toContainEqual(["code"]);
    expect(items[0]).toMatchObject({
      source_path: "web-ui/src/lib/settings-form.ts",
      content_type: "code",
    });
    expect(items[0].text).toContain("parseSettingsForm");
  });

  it("uses a vector+keyword RRF query when an embedding is available", async () => {
    vi.mocked(getQueryEmbedding).mockResolvedValueOnce([0.1, 0.2, 0.3]);
    const calls: Array<{ text: string; params?: unknown[] }> = [];
    const pool = {
      query: async <T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> => {
        calls.push({ text, params });

        return {
          rows: [
            {
              content: "code",
              file_path: "a.ts",
              content_type: "code",
              score: 0.5,
            },
          ] as T[],
        };
      },
    };

    await hybridChunkItems(pool, "q", "re-cinq/lore", ["code"], 6);

    expect(calls[0].text).toContain("embedding <=>");
    expect(calls[0].params).toContainEqual("[0.1,0.2,0.3]");
  });

  it("normalizes scores so the top result is 1.0 and the rest are fractions", async () => {
    vi.mocked(getQueryEmbedding).mockResolvedValueOnce(null);
    const pool = {
      query: async () => ({
        rows: [
          {
            content: "a",
            file_path: "a.ts",
            content_type: "code",
            score: 0.033,
          },
          {
            content: "b",
            file_path: "b.ts",
            content_type: "code",
            score: 0.0165,
          },
        ],
      }),
    };

    const items = (await hybridChunkItems(
      pool as unknown as Parameters<typeof hybridChunkItems>[0],
      "q",
      "re-cinq/lore",
      ["code"],
      6,
    )) as Array<{ score?: number }>;

    expect(items[0].score).toBeCloseTo(1.0);
    expect(items[1].score).toBeCloseTo(0.5);
  });
});
