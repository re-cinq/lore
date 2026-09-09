import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PgChunks } from "./chunks-pg.js";
import { InMemoryChunks } from "./chunks-memory.js";
import type { ChunkInsert } from "./chunks-port.js";
import type { PgPool } from "../../memory-store.js";

function fakePool(...results: Array<{ rows: any[] }>): {
  pool: PgPool;
  calls: Array<{ text: string; params?: unknown[] }>;
} {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const queue = [...results];
  const pool: PgPool = {
    async query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> {
      calls.push({ text, params });

      return queue.length > 1 ? queue.shift()! : (queue[0] ?? { rows: [] });
    },
  };

  return { pool, calls };
}

const sampleChunk: ChunkInsert = {
  content: "hello world",
  contentType: "spec",
  team: "platform",
  repo: "octo/repo",
  filePath: "specs/spec.md",
  metadata: { chunk_index: 0, ingested_by: "reindex-job" },
};

const teamSchemaLookup = [
  { rows: [{ team: "platform" }] },
  { rows: [{ schema_name: "platform" }] },
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PgChunks adapter", () => {
  it("returns true when information_schema lists the schema", async () => {
    const { pool, calls } = fakePool({ rows: [{ schema_name: "platform" }] });

    expect(await new PgChunks(pool).schemaExists("platform")).toBe(true);
    expect(calls[0]?.text).toContain("FROM information_schema.schemata");
    expect(calls[0]?.params).toEqual(["platform"]);
  });

  it("returns false when information_schema returns no rows", async () => {
    const { pool } = fakePool({ rows: [] });

    expect(await new PgChunks(pool).schemaExists("missing")).toBe(false);
  });

  it("counts chunks for a repo within an interpolated schema", async () => {
    const { pool, calls } = fakePool({ rows: [{ c: "7" }] });

    const count = await new PgChunks(pool).countChunks("platform", "octo/repo");

    expect(count).toBe(7);
    expect(calls[0]?.text).toContain("FROM platform.chunks WHERE repo = $1");
    expect(calls[0]?.params).toEqual(["octo/repo"]);
  });

  it("deletes chunks for a file by path and repo", async () => {
    const { pool, calls } = fakePool();

    await new PgChunks(pool).deleteChunksForFile(
      "platform",
      "specs/spec.md",
      "octo/repo",
    );

    expect(calls[0]?.text).toContain(
      "DELETE FROM platform.chunks WHERE file_path = $1 AND repo = $2",
    );
    expect(calls[0]?.params).toEqual(["specs/spec.md", "octo/repo"]);
  });

  it("inserts a chunk and returns the new id, stringifying metadata", async () => {
    const { pool, calls } = fakePool({ rows: [{ id: "42" }] });

    const id = await new PgChunks(pool).insertChunk("platform", sampleChunk);

    expect(id).toBe("42");
    expect(calls[0]?.text).toContain("INSERT INTO platform.chunks");
    expect(calls[0]?.params).toEqual([
      "hello world",
      "spec",
      "platform",
      "octo/repo",
      "specs/spec.md",
      JSON.stringify({ chunk_index: 0, ingested_by: "reindex-job" }),
    ]);
  });

  it("returns null when the insert yields no row", async () => {
    const { pool } = fakePool({ rows: [] });

    expect(
      await new PgChunks(pool).insertChunk("platform", sampleChunk),
    ).toBeNull();
  });

  it("sets the embedding via the caller-formatted vector string", async () => {
    const { pool, calls } = fakePool();

    await new PgChunks(pool).setEmbedding("platform", "42", "[0.1,0.2,0.3]");

    expect(calls[0]?.text).toContain(
      "UPDATE platform.chunks SET embedding = $1::vector WHERE id = $2",
    );
    expect(calls[0]?.params).toEqual(["[0.1,0.2,0.3]", "42"]);
  });

  it("returns distinct non-null teams from org_shared.chunks", async () => {
    const { pool, calls } = fakePool({
      rows: [{ team: "platform" }, { team: "growth" }],
    });

    expect(await new PgChunks(pool).distinctTeams()).toEqual([
      "platform",
      "growth",
    ]);
    expect(calls[0]?.text).toContain(
      "FROM org_shared.chunks WHERE team IS NOT NULL",
    );
  });

  it("parses the org_shared count for a team to a number", async () => {
    const { pool, calls } = fakePool({ rows: [{ count: "12" }] });

    expect(await new PgChunks(pool).countChunksByTeam("platform")).toBe(12);
    expect(calls[0]?.text).toContain("FROM org_shared.chunks WHERE team = $1");
    expect(calls[0]?.params).toEqual(["platform"]);
  });

  it("defaults a missing org_shared count row to zero", async () => {
    const { pool } = fakePool({ rows: [] });

    expect(await new PgChunks(pool).countChunksByTeam("platform")).toBe(0);
  });

  it("rejects a schema name carrying an injection payload", async () => {
    const { pool } = fakePool();

    await expect(
      new PgChunks(pool).countChunks("a; DROP TABLE", "octo/repo"),
    ).rejects.toThrow(new Error('Invalid schema name: "a; DROP TABLE"'));
  });

  it("reads a repo's spec chunks from its team schema", async () => {
    const { pool, calls } = fakePool(...teamSchemaLookup, {
      rows: [
        { id: "1", repo: "octo/repo", file_path: "specs/s.md", content: "x" },
      ],
    });

    const specs = await new PgChunks(pool).specChunks("octo/repo");

    expect(specs).toEqual([
      { id: "1", repo: "octo/repo", filePath: "specs/s.md", content: "x" },
    ]);
    expect(calls[2]?.text).toContain("FROM platform.chunks");
    expect(calls[2]?.text).not.toContain("org_shared");
    expect(calls[2]?.text).toContain("content_type = 'spec'");
    expect(calls[2]?.params).toEqual(["octo/repo"]);
  });

  it("reads spec chunks from org_shared when the repo has no team", async () => {
    const { pool, calls } = fakePool(
      { rows: [] },
      {
        rows: [
          { id: "1", repo: "octo/repo", file_path: "specs/s.md", content: "x" },
        ],
      },
    );

    const specs = await new PgChunks(pool).specChunks("octo/repo");

    expect(specs).toEqual([
      { id: "1", repo: "octo/repo", filePath: "specs/s.md", content: "x" },
    ]);
    expect(calls[1]?.text).toContain("FROM org_shared.chunks");
    expect(calls[1]?.params).toEqual(["octo/repo"]);
  });

  it("reads a repo's code symbols from its team schema", async () => {
    const { pool, calls } = fakePool(...teamSchemaLookup, {
      rows: [
        {
          symbol_name: "runDetect",
          symbol_type: "function",
          file_path: "a.ts",
        },
      ],
    });

    const symbols = await new PgChunks(pool).codeSymbols("octo/repo");

    expect(symbols).toEqual([
      { symbolName: "runDetect", symbolType: "function", filePath: "a.ts" },
    ]);
    expect(calls[2]?.text).toContain("FROM platform.chunks");
    expect(calls[2]?.text).not.toContain("org_shared");
    expect(calls[2]?.text).toContain("symbol_name");
    expect(calls[2]?.params).toEqual(["octo/repo"]);
  });

  it("reads code symbols from org_shared when the repo has no team", async () => {
    const { pool, calls } = fakePool(
      { rows: [] },
      {
        rows: [
          {
            symbol_name: "runDetect",
            symbol_type: "function",
            file_path: "a.ts",
          },
        ],
      },
    );

    const symbols = await new PgChunks(pool).codeSymbols("octo/repo");

    expect(symbols).toEqual([
      { symbolName: "runDetect", symbolType: "function", filePath: "a.ts" },
    ]);
    expect(calls[1]?.text).toContain("FROM org_shared.chunks");
    expect(calls[1]?.params).toEqual(["octo/repo"]);
  });

  it("reads test ranges and backfill chunks from code and test rows alike, and symbols from code rows only", async () => {
    const { pool, calls } = fakePool(...teamSchemaLookup, { rows: [] });
    const chunks = new PgChunks(pool);

    await chunks.testChunkRanges("octo/repo");
    await chunks.codeChunksForBackfill("octo/repo");
    await chunks.codeSymbols("octo/repo");

    const filters = calls
      .filter((c) => c.text.includes("FROM platform.chunks"))
      .map(
        (c) =>
          c.text
            .replace(/\s+/g, " ")
            .match(/content_type [^A]*?(?= AND| ORDER|$)/)?.[0],
      );

    expect(filters).toEqual([
      "content_type IN ('code', 'test')",
      "content_type IN ('code', 'test')",
      "content_type = 'code'",
    ]);
  });

  it("checks chunk existence in the repo's team schema", async () => {
    const { pool, calls } = fakePool(...teamSchemaLookup, {
      rows: [{ id: "1" }],
    });

    expect(
      await new PgChunks(pool).hasChunk("octo/repo", "doc", "CLAUDE.md"),
    ).toBe(true);
    expect(calls[2]?.text).toContain("FROM platform.chunks");
    expect(calls[2]?.text).not.toContain("org_shared");
    expect(calls[2]?.text).toContain("file_path LIKE");
    expect(calls[2]?.params).toEqual(["octo/repo", "doc", "%CLAUDE.md"]);
  });

  it("falls back to org_shared for chunk existence when the repo has no team", async () => {
    const { pool, calls } = fakePool({ rows: [] }, { rows: [{ id: "1" }] });

    expect(await new PgChunks(pool).hasChunk("octo/repo", "adr")).toBe(true);
    expect(calls[1]?.text).toContain("FROM org_shared.chunks");
    expect(calls[1]?.params).toEqual(["octo/repo", "adr"]);
  });

  it("reads spec chunks with chunk_index in document order from the team schema", async () => {
    const { pool, calls } = fakePool(...teamSchemaLookup, {
      rows: [
        {
          repo: "octo/repo",
          file_path: "specs/s.md",
          content: "part one",
          ingested_at: "2026-01-01",
          chunk_index: 0,
        },
        {
          repo: "octo/repo",
          file_path: "specs/s.md",
          content: "legacy",
          ingested_at: "2026-01-01",
          chunk_index: null,
        },
      ],
    });

    const specs = await new PgChunks(pool).specChunksWithIngest("octo/repo");

    expect(specs).toEqual([
      {
        repo: "octo/repo",
        filePath: "specs/s.md",
        content: "part one",
        ingestedAt: "2026-01-01",
        chunkIndex: 0,
      },
      {
        repo: "octo/repo",
        filePath: "specs/s.md",
        content: "legacy",
        ingestedAt: "2026-01-01",
        chunkIndex: null,
      },
    ]);
    expect(calls[2]?.text).toContain("(metadata->>'chunk_index')::int");
    expect(calls[2]?.text).toContain(
      "ORDER BY file_path, (metadata->>'chunk_index')::int NULLS LAST, ingested_at, id",
    );
  });

  it("reads backfill spec chunks with chunk_index ordering and the embedding", async () => {
    const { pool, calls } = fakePool(...teamSchemaLookup, {
      rows: [
        {
          repo: "octo/repo",
          file_path: "specs/s.md",
          content: "part one",
          ingested_at: "2026-01-01",
          chunk_index: 0,
          embedding: "[0.1,0.2]",
        },
      ],
    });

    const specs = await new PgChunks(pool).specChunksForBackfill("octo/repo");

    expect(specs).toEqual([
      {
        repo: "octo/repo",
        filePath: "specs/s.md",
        content: "part one",
        ingestedAt: "2026-01-01",
        chunkIndex: 0,
        embedding: "[0.1,0.2]",
      },
    ]);
    expect(calls[2]?.text).toContain("(metadata->>'chunk_index')::int");
    expect(calls[2]?.text).toContain(
      "ORDER BY file_path, (metadata->>'chunk_index')::int NULLS LAST, ingested_at, id",
    );
  });

  it("rejects a schema name carrying an injection payload on the relocation surface", async () => {
    const { pool } = fakePool();

    await expect(
      new PgChunks(pool).relocateLegacyChunks("a; DROP TABLE", "octo/repo"),
    ).rejects.toThrow(new Error('Invalid schema name: "a; DROP TABLE"'));
  });
});

describe("InMemoryChunks double", () => {
  it("inserts rows with incrementing string ids and counts them per repo", async () => {
    const chunks = new InMemoryChunks();

    const first = await chunks.insertChunk("platform", sampleChunk);
    const second = await chunks.insertChunk("platform", sampleChunk);

    expect(first).toBe("1");
    expect(second).toBe("2");
    expect(await chunks.countChunks("platform", "octo/repo")).toBe(2);
  });

  it("scopes deletes to schema, file_path and repo", async () => {
    const chunks = new InMemoryChunks();

    await chunks.insertChunk("platform", sampleChunk);
    await chunks.insertChunk("platform", {
      ...sampleChunk,
      filePath: "specs/other.md",
    });

    await chunks.deleteChunksForFile("platform", "specs/spec.md", "octo/repo");

    expect(await chunks.countChunks("platform", "octo/repo")).toBe(1);
    expect(chunks.rows[0]?.filePath).toBe("specs/other.md");
  });

  it("stores the formatted embedding on the matching row", async () => {
    const chunks = new InMemoryChunks();
    const id = await chunks.insertChunk("platform", sampleChunk);

    await chunks.setEmbedding("platform", id!, "[0.1,0.2]");

    expect(chunks.rows[0]?.embedding).toBe("[0.1,0.2]");
  });

  it("reports schema existence from the seeded set", async () => {
    const chunks = new InMemoryChunks([], new Set(["org_shared", "platform"]));

    expect(await chunks.schemaExists("platform")).toBe(true);
    expect(await chunks.schemaExists("growth")).toBe(false);
  });

  it("returns distinct teams and per-team counts from org_shared rows only", async () => {
    const chunks = new InMemoryChunks();

    await chunks.insertChunk("org_shared", {
      ...sampleChunk,
      team: "platform",
    });
    await chunks.insertChunk("org_shared", {
      ...sampleChunk,
      team: "platform",
    });
    await chunks.insertChunk("org_shared", { ...sampleChunk, team: "growth" });
    await chunks.insertChunk("platform", { ...sampleChunk, team: "platform" });

    expect((await chunks.distinctTeams()).sort()).toEqual([
      "growth",
      "platform",
    ]);
    expect(await chunks.countChunksByTeam("platform")).toBe(2);
    expect(await chunks.countChunksByTeam("growth")).toBe(1);
  });

  it("excludes legacy null-team rows from distinct teams", async () => {
    const chunks = new InMemoryChunks();

    await chunks.insertChunk("org_shared", {
      ...sampleChunk,
      team: "platform",
    });
    chunks.rows.push({
      id: "legacy",
      schema: "org_shared",
      content: "legacy content",
      contentType: "spec",
      team: null,
      repo: sampleChunk.repo,
      filePath: "legacy.md",
      metadata: {},
      embedding: null,
      ingestedAt: new Date().toISOString(),
    });

    expect(await chunks.distinctTeams()).toEqual(["platform"]);
  });

  it("rejects a schema name carrying an injection payload", async () => {
    const chunks = new InMemoryChunks();

    await expect(
      chunks.insertChunk("a; DROP TABLE", sampleChunk),
    ).rejects.toThrow(new Error('Invalid schema name: "a; DROP TABLE"'));
  });

  it("reads spec chunks and code symbols from whichever schema holds the repo's rows", async () => {
    const chunks = new InMemoryChunks();

    await chunks.insertChunk("platform", {
      ...sampleChunk,
      contentType: "spec",
      filePath: "specs/s.md",
    });
    await chunks.insertChunk("platform", {
      ...sampleChunk,
      contentType: "code",
      filePath: "a.ts",
      metadata: { symbol_name: "runDetect", symbol_type: "function" },
    });
    await chunks.insertChunk("platform", {
      ...sampleChunk,
      contentType: "code",
      filePath: "b.ts",
      metadata: {},
    });

    expect(await chunks.specChunks("octo/repo")).toMatchObject([
      { filePath: "specs/s.md", content: "hello world" },
    ]);
    expect(await chunks.codeSymbols("octo/repo")).toEqual([
      { symbolName: "runDetect", symbolType: "function", filePath: "a.ts" },
    ]);
  });

  it("reports chunk existence from whichever schema holds the repo's rows", async () => {
    const chunks = new InMemoryChunks();

    await chunks.insertChunk("platform", {
      ...sampleChunk,
      contentType: "doc",
      filePath: "docs/CLAUDE.md",
    });

    expect(await chunks.hasChunk("octo/repo", "doc", "CLAUDE.md")).toBe(true);
    expect(await chunks.hasChunk("octo/repo", "doc", "AGENTS.md")).toBe(false);
    expect(await chunks.hasChunk("octo/repo", "adr")).toBe(false);
  });

  it("returns spec chunks with equal ingest stamps in chunk_index order", async () => {
    const chunks = new InMemoryChunks();

    await chunks.insertChunk("platform", {
      ...sampleChunk,
      content: "part three",
      metadata: { chunk_index: 2 },
    });
    await chunks.insertChunk("platform", {
      ...sampleChunk,
      content: "part one",
      metadata: { chunk_index: 0 },
    });
    await chunks.insertChunk("platform", {
      ...sampleChunk,
      content: "part two",
      metadata: { chunk_index: 1 },
    });
    const stamp = new Date().toISOString();

    for (const row of chunks.rows) {
      row.ingestedAt = stamp;
    }

    expect(await chunks.specChunksWithIngest("octo/repo")).toMatchObject([
      { content: "part one", chunkIndex: 0 },
      { content: "part two", chunkIndex: 1 },
      { content: "part three", chunkIndex: 2 },
    ]);
    expect(await chunks.specChunksForBackfill("octo/repo")).toMatchObject([
      { content: "part one", chunkIndex: 0 },
      { content: "part two", chunkIndex: 1 },
      { content: "part three", chunkIndex: 2 },
    ]);
  });
});

describe("relocateLegacyChunks", () => {
  const legacyRow = (
    over: Partial<(typeof InMemoryChunks.prototype.rows)[0]>,
  ) => ({
    id: over.id ?? "legacy-1",
    schema: "org_shared",
    content: "legacy content",
    contentType: "doc",
    team: "org_shared",
    repo: "octo/repo",
    filePath: "docs/x.md",
    metadata: {},
    embedding: "[0.5]",
    ingestedAt: "2025-01-01T00:00:00.000Z",
    ...over,
  });

  it("moves a non-duplicated legacy row keeping id and embedding, rewrites team, stamps migrated_from, adopts classifiable rows", async () => {
    const chunks = new InMemoryChunks([legacyRow({})]);

    expect(await chunks.relocateLegacyChunks("platform", "octo/repo")).toEqual({
      moved: 1,
      dropped: 1,
    });
    expect(chunks.rows[0]).toMatchObject({
      id: "legacy-1",
      schema: "platform",
      team: "platform",
      embedding: "[0.5]",
      ingestedAt: "2025-01-01T00:00:00.000Z",
      metadata: { migrated_from: "org_shared", ingested_by: "reindex-job" },
    });
  });

  it("keeps the fresh target copy and drops the stale org_shared duplicate of the same file", async () => {
    const chunks = new InMemoryChunks([
      legacyRow({ id: "stale", filePath: "specs/spec.md" }),
      legacyRow({
        id: "fresh",
        schema: "platform",
        team: "platform",
        filePath: "specs/spec.md",
        content: "fresh content",
      }),
    ]);

    expect(await chunks.relocateLegacyChunks("platform", "octo/repo")).toEqual({
      moved: 0,
      dropped: 1,
    });
    expect(chunks.rows).toHaveLength(1);
    expect(chunks.rows[0]).toMatchObject({
      id: "fresh",
      content: "fresh content",
    });
  });

  it("relocates a rule row without adopting it into reindex ownership", async () => {
    const chunks = new InMemoryChunks([
      legacyRow({ contentType: "rule", filePath: "rules/conventions" }),
    ]);

    await chunks.relocateLegacyChunks("platform", "octo/repo");

    expect(chunks.rows[0]!.metadata).toEqual({ migrated_from: "org_shared" });
  });

  it("moves every chunk of a multi-chunk file instead of deduping against its own first chunk", async () => {
    const chunks = new InMemoryChunks([
      legacyRow({ id: "c1", filePath: "specs/big.md" }),
      legacyRow({ id: "c2", filePath: "specs/big.md" }),
    ]);

    expect(await chunks.relocateLegacyChunks("platform", "octo/repo")).toEqual({
      moved: 2,
      dropped: 2,
    });
    expect(chunks.rows.every((row) => row.schema === "platform")).toBe(true);
  });

  it("returns zeros on a clean repo and on a second run", async () => {
    const chunks = new InMemoryChunks([legacyRow({})]);

    await chunks.relocateLegacyChunks("platform", "octo/repo");

    expect(await chunks.relocateLegacyChunks("platform", "octo/repo")).toEqual({
      moved: 0,
      dropped: 0,
    });
  });

  it("rejects org_shared as the relocation target in both adapters", async () => {
    await expect(
      new InMemoryChunks().relocateLegacyChunks("org_shared", "octo/repo"),
    ).rejects.toThrow(/must not be org_shared/);
    await expect(
      new PgChunks(fakePool({ rows: [] }).pool).relocateLegacyChunks(
        "org_shared",
        "octo/repo",
      ),
    ).rejects.toThrow(/must not be org_shared/);
  });

  it("issues one statement with the insert before the delete and repo/schema as parameters", async () => {
    const { pool, calls } = fakePool({
      rows: [{ moved: "2", dropped: "3" }],
    });

    expect(
      await new PgChunks(pool).relocateLegacyChunks("platform", "octo/repo"),
    ).toEqual({ moved: 2, dropped: 3 });
    expect(calls).toHaveLength(1);

    const sql = calls[0]!.text;

    expect(calls[0]!.params).toEqual(["octo/repo", "platform"]);
    expect(sql.indexOf("INSERT INTO platform.chunks")).toBeGreaterThan(-1);
    expect(sql.indexOf("DELETE FROM org_shared.chunks")).toBeGreaterThan(
      sql.indexOf("INSERT INTO platform.chunks"),
    );
    expect(sql).toContain("ON CONFLICT (id) DO NOTHING");
    expect(sql).not.toContain("search_tsv");
  });
});

describe("codeSymbols call exclusion", () => {
  it("excludes call-typed chunks so describe titles never enter the symbol surface", async () => {
    const chunks = new InMemoryChunks();

    await chunks.insertChunk("platform", {
      ...sampleChunk,
      contentType: "code",
      filePath: "src/queue.ts",
      metadata: {
        chunk_index: 0,
        symbol_name: "PgTaskQueue",
        symbol_type: "class",
      },
    });
    await chunks.insertChunk("platform", {
      ...sampleChunk,
      contentType: "code",
      filePath: "src/queue.test.ts",
      metadata: {
        chunk_index: 0,
        symbol_name: "PgTaskQueue",
        symbol_type: "call",
      },
    });

    expect(await chunks.codeSymbols("octo/repo")).toEqual([
      {
        symbolName: "PgTaskQueue",
        symbolType: "class",
        filePath: "src/queue.ts",
      },
    ]);
  });

  it("filters symbol_type call in the SQL read", async () => {
    const { pool, calls } = fakePool(...teamSchemaLookup, { rows: [] });

    await new PgChunks(pool).codeSymbols("octo/repo");

    expect(calls[2]?.text).toContain(
      "metadata->>'symbol_type' IS DISTINCT FROM 'call'",
    );
  });
});
