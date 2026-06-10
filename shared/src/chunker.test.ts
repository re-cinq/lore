import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { chunkFile, buildIngestedChunkMetadata } from "./chunker.js";

describe("chunkFile", () => {
  it("stamps content_hash equal to sha256 of the chunk's own content", async () => {
    const markdown = "Lore tracks every chunk by hash.";

    const chunks = await chunkFile(markdown, "notes.md", "doc");
    const chunk = chunks[0];

    const expectedHash = createHash("sha256").update(chunk.content).digest("hex");

    expect(chunk.metadata.content_hash).toBe(expectedHash);
  });
});

describe("buildIngestedChunkMetadata", () => {
  it("carries content_hash, file_path, and ingested_by from an api ingest", async () => {
    const [chunk] = await chunkFile("Persisted by the api.", "notes.md", "doc");

    const meta = buildIngestedChunkMetadata(chunk, {
      filePath: "notes.md",
      ingestedBy: "api",
      commit: "abc123",
    });

    expect(meta).toMatchObject({
      content_hash: chunk.metadata.content_hash,
      file_path: "notes.md",
      ingested_by: "api",
      commit: "abc123",
    });
  });

  it("omits commit when not provided for a reindex-job ingest", async () => {
    const [chunk] = await chunkFile("Persisted by reindex.", "notes.md", "doc");

    const meta = buildIngestedChunkMetadata(chunk, {
      filePath: "notes.md",
      ingestedBy: "reindex-job",
    });

    expect(meta).toMatchObject({
      content_hash: chunk.metadata.content_hash,
      file_path: "notes.md",
      ingested_by: "reindex-job",
    });
    expect("commit" in meta).toBe(false);
  });
});
