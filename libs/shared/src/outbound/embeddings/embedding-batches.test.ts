import { describe, it, expect } from "vitest";
import { embeddingBatches } from "./embedding-batches.js";

describe("embeddingBatches", () => {
  it("splits 251 short texts into batches of 250 and 1", () => {
    const texts = Array.from({ length: 251 }, (_, i) => `statement ${i}`);

    expect(embeddingBatches(texts).map((batch) => batch.length)).toEqual([
      250, 1,
    ]);
  });

  it("starts a new batch when the next 8000-char text would pass 50000 chars", () => {
    const texts = Array.from({ length: 7 }, () => "x".repeat(8000));

    expect(embeddingBatches(texts).map((batch) => batch.length)).toEqual([
      6, 1,
    ]);
  });

  it("returns no batches for no texts", () => {
    expect(embeddingBatches([])).toEqual([]);
  });
});
