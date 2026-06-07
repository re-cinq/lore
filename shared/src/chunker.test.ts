import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { chunkFile } from "./chunker.js";

describe("chunkFile", () => {
  it("stamps content_hash equal to sha256 of the chunk's own content", async () => {
    const markdown = "Lore tracks every chunk by hash.";

    const chunks = await chunkFile(markdown, "notes.md", "doc");
    const chunk = chunks[0];

    const expectedHash = createHash("sha256").update(chunk.content).digest("hex");

    expect(chunk.metadata.content_hash).toBe(expectedHash);
  });
});
