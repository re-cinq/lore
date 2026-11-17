import { describe, it, expect } from "vitest";
import { startRecordingHttpServer } from "../../test-helpers/recording-http-server.js";
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

  it("throws naming the unknown vendor for LORE_EMBEDDING_PROVIDER=voyage", () => {
    expect(() =>
      selectEmbeddingProvider({ LORE_EMBEDDING_PROVIDER: "voyage" }),
    ).toThrow(
      new Error('no embedding provider named "voyage"; known: vertex, openai'),
    );
  });

  it("picks openai with model text-embedding-3-large for LORE_EMBEDDING_PROVIDER=openai and LORE_EMBEDDING_MODEL=text-embedding-3-large", () => {
    const provider = selectEmbeddingProvider({
      LORE_EMBEDDING_PROVIDER: "openai",
      LORE_EMBEDDING_MODEL: "text-embedding-3-large",
    });

    expect({ vendor: provider.vendor, model: provider.model }).toEqual({
      vendor: "openai",
      model: "text-embedding-3-large",
    });
  });

  it("sends the env's OPENAI_BASE_URL and OPENAI_API_KEY to the selected openai provider", async () => {
    const server = await startRecordingHttpServer({
      data: [{ index: 0, embedding: Array(768).fill(0) }],
    });
    const provider = selectEmbeddingProvider({
      LORE_EMBEDDING_PROVIDER: "openai",
      OPENAI_BASE_URL: server.baseUrl,
      OPENAI_API_KEY: "k9",
    });

    await provider.embed(["a"]);
    server.close();

    expect(server.requests).toMatchObject([
      { url: "/openai/v1/embeddings", authorization: "Bearer k9" },
    ]);
  });
});
