import { describe, it, expect } from "vitest";
import { FakeEmbeddingProvider } from "./fake-embedding-provider.js";

describe("FakeEmbeddingProvider", () => {
  it("embeds 'a' and 'bbb' as one-element vectors 1 and 3 by default", async () => {
    expect(await new FakeEmbeddingProvider().embed(["a", "bbb"])).toEqual([
      [1],
      [3],
    ]);
  });

  it("answers with the vectors of the function it was constructed with, null for 'skip'", async () => {
    const provider = new FakeEmbeddingProvider((text) =>
      text === "skip" ? null : [0.5, 0.25],
    );

    expect(await provider.embed(["keep", "skip"])).toEqual([[0.5, 0.25], null]);
  });

  it("records the texts of two embed calls in order", async () => {
    const provider = new FakeEmbeddingProvider();

    await provider.embed(["a"]);
    await provider.embed(["b", "c"]);

    expect(provider.calls).toEqual([["a"], ["b", "c"]]);
  });

  it("reports vendor fake, model fake and dimensions 768 by default", () => {
    expect(new FakeEmbeddingProvider()).toMatchObject({
      vendor: "fake",
      model: "fake",
      dimensions: 768,
    });
  });

  it("reports dimensions 3 when constructed with dimensions 3", () => {
    const provider = new FakeEmbeddingProvider(() => [1, 2, 3], {
      dimensions: 3,
    });

    expect(provider.dimensions).toBe(3);
  });
});
