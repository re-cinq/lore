import { describe, it, expect } from "vitest";
import { InMemoryChunks } from "@re-cinq/lore-shared/project/chunks/chunks-memory.js";
import { verifyRepoChunks } from "./verify.js";

const REPO = "octo/repo";
const SCHEMA = "platform";
const OLD = new Date(Date.now() - 100 * 86_400_000).toISOString();

function seededChunks(): InMemoryChunks {
  const chunks = new InMemoryChunks([], new Set(["org_shared", SCHEMA]));

  chunks.rows.push(
    {
      id: "1",
      schema: SCHEMA,
      content: "kept",
      contentType: "spec",
      team: SCHEMA,
      repo: REPO,
      filePath: "specs/kept.md",
      metadata: { ingested_by: "reindex-job" },
      embedding: null,
      ingestedAt: OLD,
    },
    {
      id: "2",
      schema: SCHEMA,
      content: "gone",
      contentType: "spec",
      team: SCHEMA,
      repo: REPO,
      filePath: "specs/gone.md",
      metadata: { ingested_by: "reindex-job" },
      embedding: null,
      ingestedAt: OLD,
    },
    {
      id: "3",
      schema: SCHEMA,
      content: "api-owned",
      contentType: "spec",
      team: SCHEMA,
      repo: REPO,
      filePath: "specs/api-owned.md",
      metadata: { ingested_by: "api" },
      embedding: null,
      ingestedAt: OLD,
    },
  );

  return chunks;
}

describe("verifyRepoChunks", () => {
  it("re-stamps in-tree reindex-owned chunks so the stale count drops to zero", async () => {
    const chunks = seededChunks();

    chunks.rows = chunks.rows.filter((row) => row.filePath === "specs/kept.md");

    const result = await verifyRepoChunks(chunks, SCHEMA, REPO, [
      "specs/kept.md",
      "README.md",
    ]);

    expect(result).toEqual({ touched: 1, pruned: 0 });
    expect(await chunks.staleChunkCount(REPO, 90)).toBe(0);
  });

  it("prunes reindex-owned chunks of files missing from the tree", async () => {
    const chunks = seededChunks();

    const result = await verifyRepoChunks(chunks, SCHEMA, REPO, [
      "specs/kept.md",
    ]);

    expect(result).toEqual({ touched: 1, pruned: 1 });
    expect(chunks.rows.map((row) => row.filePath).sort()).toEqual([
      "specs/api-owned.md",
      "specs/kept.md",
    ]);
  });

  it("never touches or prunes api-ingested chunks", async () => {
    const chunks = seededChunks();

    await verifyRepoChunks(chunks, SCHEMA, REPO, ["specs/kept.md"]);

    const apiRow = chunks.rows.find(
      (row) => row.filePath === "specs/api-owned.md",
    );

    expect(apiRow?.ingestedAt).toBe(OLD);
  });

  it("does nothing when the tree is empty", async () => {
    const chunks = seededChunks();

    const result = await verifyRepoChunks(chunks, SCHEMA, REPO, []);

    expect(result).toEqual({ touched: 0, pruned: 0 });
    expect(chunks.rows).toHaveLength(3);
    expect(chunks.rows.every((row) => row.ingestedAt === OLD)).toBe(true);
  });
});
