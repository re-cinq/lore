import { describe, it, expect } from "vitest";
import { PgChunks } from "./chunks-pg.js";
import { InMemoryChunks } from "./chunks-memory.js";
import type { ChunkInsert } from "./chunks-port.js";
import type { PgPool } from "../../memory-store.js";

function fakePool(
  result: { rows: any[] } = { rows: [] },
): { pool: PgPool; calls: Array<{ text: string; params?: unknown[] }> } {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const pool: PgPool = {
    async query(text: string, params?: unknown[]) {
      calls.push({ text, params });
      return result;
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
  metadata: { chunk_index: 0, ingestedBy: "reindex-job" },
};

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

    await new PgChunks(pool).deleteChunksForFile("platform", "specs/spec.md", "octo/repo");

    expect(calls[0]?.text).toContain("DELETE FROM platform.chunks WHERE file_path = $1 AND repo = $2");
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
      JSON.stringify({ chunk_index: 0, ingestedBy: "reindex-job" }),
    ]);
  });

  it("returns null when the insert yields no row", async () => {
    const { pool } = fakePool({ rows: [] });

    expect(await new PgChunks(pool).insertChunk("platform", sampleChunk)).toBeNull();
  });

  it("sets the embedding via the caller-formatted vector string", async () => {
    const { pool, calls } = fakePool();

    await new PgChunks(pool).setEmbedding("platform", "42", "[0.1,0.2,0.3]");

    expect(calls[0]?.text).toContain("UPDATE platform.chunks SET embedding = $1::vector WHERE id = $2");
    expect(calls[0]?.params).toEqual(["[0.1,0.2,0.3]", "42"]);
  });

  it("returns distinct non-null teams from org_shared.chunks", async () => {
    const { pool, calls } = fakePool({ rows: [{ team: "platform" }, { team: "growth" }] });

    expect(await new PgChunks(pool).distinctTeams()).toEqual(["platform", "growth"]);
    expect(calls[0]?.text).toContain("FROM org_shared.chunks WHERE team IS NOT NULL");
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
    await chunks.insertChunk("platform", { ...sampleChunk, filePath: "specs/other.md" });

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
    await chunks.insertChunk("org_shared", { ...sampleChunk, team: "platform" });
    await chunks.insertChunk("org_shared", { ...sampleChunk, team: "platform" });
    await chunks.insertChunk("org_shared", { ...sampleChunk, team: "growth" });
    await chunks.insertChunk("platform", { ...sampleChunk, team: "platform" });

    expect((await chunks.distinctTeams()).sort()).toEqual(["growth", "platform"]);
    expect(await chunks.countChunksByTeam("platform")).toBe(2);
    expect(await chunks.countChunksByTeam("growth")).toBe(1);
  });

  it("rejects a schema name carrying an injection payload", async () => {
    const chunks = new InMemoryChunks();

    await expect(
      chunks.insertChunk("a; DROP TABLE", sampleChunk),
    ).rejects.toThrow(new Error('Invalid schema name: "a; DROP TABLE"'));
  });
});
