import { describe, it, expect, afterEach } from "vitest";
import { Embeddings } from "./embeddings.js";
import { FakeEmbeddingProvider } from "./fake-embedding-provider.js";

describe("Embeddings singleton", () => {
  afterEach(() => Embeddings.reset());

  it("returns the provider installed via setInstance", () => {
    const fake = new FakeEmbeddingProvider();

    Embeddings.setInstance(fake);

    expect(Embeddings.instance).toBe(fake);
  });

  it("drops an installed fake on reset and answers with the env-selected vertex provider", () => {
    Embeddings.setInstance(new FakeEmbeddingProvider());
    Embeddings.reset();

    expect(Embeddings.instance.vendor).toBe("vertex");
  });

  it("hands back the same env-selected provider on a second ask", () => {
    expect(Embeddings.instance).toBe(Embeddings.instance);
  });
});
