import { describe, it, expect, vi } from "vitest";

vi.mock("../../embeddings/embedding-service.js", () => ({
  getQueryEmbedding: vi.fn(async () => null),
}));

import { getQueryEmbedding } from "../../embeddings/embedding-service.js";
import {
  fetchers,
  fitItemsToBudget,
  hybridChunkItems,
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
    const sources = formatCouplingItems(block, "specs/a") as Array<{
      text: string;
      source_path?: string;
      score?: number;
    }>;

    expect(sources).toHaveLength(2);
    expect(sources[0].text).toContain("[violated]");
    expect(sources[0].text).toContain("must do X");
    expect(sources[0].text).toContain("ADR-016");
    expect(sources[0].text).toContain("a.test.ts");
    expect(sources[0].source_path).toBe("specs/a/spec.md");
    expect(sources[0].score ?? 0).toBeGreaterThan(sources[1].score ?? 0);
  });

  it("keeps the auto-merge statement and drops the station one for 'auto-merge squash policy'", () => {
    const twoTopics: GraphContextBlock = {
      statements: [
        {
          xid: "m#1",
          specPath: "specs/dark-factory/spec.md",
          specTitle: "Dark Factory",
          section: "FR3",
          statementText: "auto-merge squashes when every changed path matches",
          signal: "normal",
          adrs: [],
          testSelectors: [],
        },
        {
          xid: "s#1",
          specPath: "specs/stations/spec.md",
          specTitle: "Stations",
          section: "FR1",
          statementText: "a station pod exceeding its deadline is reaped",
          signal: "violated",
          adrs: [],
          testSelectors: [],
        },
      ],
      adrRefs: [],
      testSelectors: [],
      truncated: false,
    };

    const paths = formatCouplingItems(
      twoTopics,
      "auto-merge squash policy",
    ).map((hit) => hit.source_path);

    expect(paths).toEqual(["specs/dark-factory/spec.md"]);
  });

  it("returns nothing when no statement shares a term with the query", () => {
    expect(
      formatCouplingItems(block, "kubernetes ingress certificate"),
    ).toEqual([]);
  });

  it("returns an empty list for an empty block", () => {
    expect(
      formatCouplingItems(
        { statements: [], adrRefs: [], testSelectors: [], truncated: false },
        "anything",
      ),
    ).toEqual([]);
  });
});

describe("fetchCouplingSource", () => {
  it("returns disabled when no graph client is wired", async () => {
    expect(await fetchCouplingSource(null, "re-cinq/lore")).toEqual({
      sources: [],
      status: "disabled",
    });
  });

  it("projects coupled statements from the graph into sources", async () => {
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
    expect(res.sources[0].text).toContain("must do X");
  });
});

describe("dropSeen (cross-section dedup)", () => {
  const it_ = (path: string) => ({ text: path, tokens: 1, source_path: path });

  it("drops sources already emitted in an earlier section, keeping the first", () => {
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

  it("drops a twin at copy/a.ts sharing content_hash abc123 with the a.ts an earlier section emitted", () => {
    const seen = new Set<string>();
    const twinOf = (path: string) => ({
      text: "same body",
      tokens: 1,
      source_path: path,
      content_hash: "abc123",
    });

    dropSeen([twinOf("a.ts")] as never, seen);

    expect(dropSeen([twinOf("copy/a.ts")] as never, seen)).toEqual([]);
  });
});

const source = (tokens: number, path: string) => ({
  text: "x".repeat(tokens * 4),
  tokens,
  source_path: path,
});

describe("fitItemsToBudget per-document cap", () => {
  it("caps a single oversized document so smaller documents still fit", () => {
    const sources = [
      source(1000, "big.md"),
      source(100, "a.md"),
      source(100, "b.md"),
    ];

    const { kept, truncated } = fitItemsToBudget(sources as never, 1000, 400);

    expect(
      (kept as Array<{ source_path: string }>).map((i) => i.source_path),
    ).toEqual(["big.md", "a.md", "b.md"]);
    expect(kept[0].tokens).toBeLessThanOrEqual(400);
    expect(truncated).toBe(true);
  });

  it("without a cap, one big document fills the budget and crowds out the rest", () => {
    const sources = [source(1000, "big.md"), source(100, "a.md")];

    const { kept } = fitItemsToBudget(sources as never, 1000);

    expect(
      (kept as Array<{ source_path: string }>).map((i) => i.source_path),
    ).toEqual(["big.md"]);
  });

  it("keeps 2 of 3 documents and drops the third when it would be cut to 40 tokens", () => {
    const sources = [
      source(480, "a.md"),
      source(480, "b.md"),
      source(200, "c.md"),
    ];

    const { kept, truncated } = fitItemsToBudget(sources as never, 1000);

    expect(
      (kept as Array<{ source_path: string }>).map((i) => i.source_path),
    ).toEqual(["a.md", "b.md"]);
    expect(truncated).toBe(true);
  });
});

function fakePool(...results: Array<{ rows: any[] }>): {
  pool: Parameters<typeof hybridChunkItems>[0];
  calls: Array<{ text: string; params?: unknown[] }>;
} {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const queue = [...results];

  return {
    calls,
    pool: {
      async query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> {
        calls.push({ text, params });

        return queue.length > 1 ? queue.shift()! : (queue[0] ?? { rows: [] });
      },
    },
  };
}

describe("hybridChunkItems", () => {
  it("retrieves chunks bound to the repo + content types (keyword path when no embedding)", async () => {
    vi.mocked(getQueryEmbedding).mockResolvedValueOnce(null);
    const { pool, calls } = fakePool(
      { rows: [] },
      {
        rows: [
          {
            content: "export function parseSettingsForm() {}",
            file_path: "web-ui/src/lib/settings-form.ts",
            content_type: "code",
            score: 0.42,
          },
        ],
      },
    );

    const sources = await hybridChunkItems(
      pool,
      "settings form parser",
      "re-cinq/lore",
      {
        contentTypes: ["code"],
        limit: 6,
      },
    );

    expect(calls[0].text).toContain("SELECT team FROM lore.repos");
    expect(calls[1].text).toContain("FROM org_shared.chunks");
    expect(calls[1].params?.[0]).toBe("re-cinq/lore");
    expect(calls[1].params).toContainEqual(["code"]);
    expect(sources[0]).toMatchObject({
      source_path: "web-ui/src/lib/settings-form.ts",
      content_type: "code",
    });
    expect(sources[0].text).toContain("parseSettingsForm");
  });

  it("keyword-only SQL filters with search_tsv @@ websearch_to_tsquery so non-matching chunks are not returned", async () => {
    vi.mocked(getQueryEmbedding).mockResolvedValueOnce(null);
    const { pool, calls } = fakePool({ rows: [] });

    await hybridChunkItems(pool, "settings form parser", "re-cinq/lore", {
      contentTypes: ["code"],
      limit: 6,
    });

    expect(calls[1].text).toContain(
      "search_tsv @@ websearch_to_tsquery('english', $2)",
    );
  });

  it("carries the chunk content_hash onto the item so twins across paths can collapse", async () => {
    vi.mocked(getQueryEmbedding).mockResolvedValueOnce(null);
    const { pool, calls } = fakePool(
      { rows: [] },
      {
        rows: [
          {
            content: "export const TRACE_IMPACT_WORKFLOW_CONTENT = 1",
            file_path: "libs/shared/src/work/trace-impact-workflow.ts",
            content_type: "code",
            score: 0.4,
            content_hash: "abc123",
          },
        ],
      },
    );

    const sources = await hybridChunkItems(
      pool,
      "trace impact",
      "re-cinq/lore",
      {
        contentTypes: ["code"],
        limit: 6,
      },
    );

    expect(calls[1].text).toContain(
      "metadata->>'content_hash' AS content_hash",
    );
    expect(sources[0]).toMatchObject({ content_hash: "abc123" });
  });

  it("returns a Conventions item of 10 tokens for a chunk whose 120-char link group was stripped", async () => {
    vi.mocked(getQueryEmbedding).mockResolvedValueOnce(null);
    const links =
      "([validated by `a.test.ts:6`](libs/shared/src/lib/a.test.ts#L6), [`b.test.ts:17`](libs/shared/src/lib/b.test.ts#L17))";
    const { pool } = fakePool(
      { rows: [] },
      {
        rows: [
          {
            content: `- FR1 Every phase ends with a commit. ${links}`,
            file_path: "specs/x/spec.md",
            content_type: "spec",
            score: 0.4,
          },
        ],
      },
    );

    const sources = await hybridChunkItems(
      pool,
      "commit phase",
      "re-cinq/lore",
      {
        contentTypes: ["doc", "spec"],
        limit: 5,
      },
    );

    expect(sources[0]).toMatchObject({
      text: "- FR1 Every phase ends with a commit.",
      tokens: 10,
    });
  });

  it("queries content_type ['code'] for 'split the api port' and ['code','test'] for 'flaky test in chunker'", async () => {
    const typesFor = async (query: string) => {
      vi.mocked(getQueryEmbedding).mockResolvedValueOnce(null);
      const { pool, calls } = fakePool({ rows: [] });

      await fetchers.code(pool, query, "re-cinq/lore");

      return calls[1].params?.[2];
    };

    expect({
      port: await typesFor("split the api port"),
      flaky: await typesFor("flaky test in chunker"),
    }).toEqual({ port: ["code"], flaky: ["code", "test"] });
  });

  it("reads from the repo's provisioned team schema instead of org_shared", async () => {
    vi.mocked(getQueryEmbedding).mockResolvedValueOnce(null);
    const { pool, calls } = fakePool(
      { rows: [{ team: "platform" }] },
      { rows: [{ table_schema: "platform" }] },
      {
        rows: [
          {
            content: "spec text",
            file_path: "specs/a/spec.md",
            content_type: "spec",
            score: 0.5,
          },
        ],
      },
    );

    await hybridChunkItems(pool, "q", "re-cinq/lore", {
      contentTypes: ["doc", "spec"],
      limit: 5,
    });

    expect(calls[2].text).toContain("FROM platform.chunks");
    expect(calls[2].text).not.toContain("org_shared");
  });

  it("uses a vector+keyword RRF query when an embedding is available", async () => {
    vi.mocked(getQueryEmbedding).mockResolvedValueOnce([0.1, 0.2, 0.3]);
    const { pool, calls } = fakePool(
      { rows: [] },
      {
        rows: [
          {
            content: "code",
            file_path: "a.ts",
            content_type: "code",
            score: 0.5,
          },
        ],
      },
    );

    await hybridChunkItems(pool, "q", "re-cinq/lore", {
      contentTypes: ["code"],
      limit: 6,
    });

    expect(calls[1].text).toContain("embedding <=>");
    expect(calls[1].params).toContainEqual("[0.1,0.2,0.3]");
  });

  it("cross_repo unions linked-repo matches across every provisioned chunk schema", async () => {
    const portable = "error handling pattern convention gotcha";
    const { pool, calls } = fakePool(
      { rows: [{ settings: { cross_repo_repos: ["octo/linked"] } }] },
      { rows: [{ table_schema: "platform" }] },
      {
        rows: [
          {
            content: portable,
            repo: "octo/linked",
            file_path: "a.md",
            score: 0.4,
          },
        ],
      },
    );

    const res = await fetchers.cross_repo(pool, "q", "re-cinq/lore");

    expect(calls[2].text).toContain("FROM platform.chunks");
    expect(calls[2].text).toContain("FROM org_shared.chunks");
    expect(calls[2].text).toContain("UNION ALL");
    expect(calls[2].text).toContain("repo = ANY($1)");
    expect(calls[2].params).toEqual([["octo/linked"], "q"]);
    expect(res.status).toBe("ok");
    expect(res.sources[0]).toMatchObject({
      repo: "octo/linked",
      text: portable,
    });
  });

  it("cross_repo without linked repos searches other repos across all schemas", async () => {
    const { pool, calls } = fakePool(
      { rows: [{ settings: null }] },
      { rows: [{ table_schema: "platform" }] },
      { rows: [] },
    );

    const res = await fetchers.cross_repo(pool, "q", "re-cinq/lore");

    expect(calls[2].text).toContain("repo != $1");
    expect(calls[2].params).toEqual(["re-cinq/lore", "q"]);
    expect(res).toEqual({ sources: [], status: "empty" });
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

    const sources = (await hybridChunkItems(
      pool as unknown as Parameters<typeof hybridChunkItems>[0],
      "q",
      "re-cinq/lore",
      {
        contentTypes: ["code"],
        limit: 6,
      },
    )) as Array<{ score?: number }>;

    expect(sources[0].score).toBeCloseTo(1.0);
    expect(sources[1].score).toBeCloseTo(0.5);
  });
});
