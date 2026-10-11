/** A real, canned-vector provider for tests: `Embeddings.setInstance(new FakeEmbeddingProvider(...))` exercises an embedding-dependent path without a network call or `vi.mock`, and records each call's texts for assertions. */

import type { EmbeddingProvider } from "./embedding-provider.js";

export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly vendor = "fake";
  readonly model = "fake";
  readonly dimensions: number;
  readonly calls: string[][] = [];

  constructor(
    private readonly vectorFor: (text: string) => number[] | null = (text) => [
      text.length,
    ],
    options: { dimensions?: number } = {},
  ) {
    this.dimensions = options.dimensions ?? 768;
  }

  async embed(texts: string[]): Promise<Array<number[] | null>> {
    this.calls.push(texts);

    return texts.map((text) => this.vectorFor(text));
  }
}
