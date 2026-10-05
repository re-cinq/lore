import { describe, it, expect } from "vitest";
import { selectEmbeddingProvider } from "./select-embedding-provider.js";

describe("selectEmbeddingProvider", () => {
  it("picks vertex when LORE_EMBEDDING_PROVIDER is unset", () => {
    expect(selectEmbeddingProvider({}).vendor).toBe("vertex");
  });

  it("picks vertex for LORE_EMBEDDING_PROVIDER=VERTEX", () => {
    expect(
      selectEmbeddingProvider({ LORE_EMBEDDING_PROVIDER: "VERTEX" }).vendor,
    ).toBe("vertex");
  });

  it("throws naming the unknown vendor for LORE_EMBEDDING_PROVIDER=openai", () => {
    expect(() =>
      selectEmbeddingProvider({ LORE_EMBEDDING_PROVIDER: "openai" }),
    ).toThrow(new Error('no embedding provider named "openai"; known: vertex'));
  });
});
