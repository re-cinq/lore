import { describe, expect, it, onTestFinished } from "vitest";
import { startRecordingHttpServer } from "../../test-helpers/recording-http-server.js";
import { selectEmbeddingProvider } from "../embeddings/select-embedding-provider.js";
import { selectProvider, selectProviderFor } from "../llm/select-provider.js";
import { openAiAuthHeader } from "./openai-auth.js";

const vector = Array<number>(768).fill(0);
const reply = {
  choices: [{ message: { content: "answer" } }],
  data: [{ index: 0, embedding: vector }],
};
const keyOnly = { xApiKey: "dummy-key", authorization: undefined };
const bearerOnly = { authorization: "Bearer dummy-key", xApiKey: undefined };

async function gateway(redirectTo?: string) {
  const server = await startRecordingHttpServer(reply, { redirectTo });

  onTestFinished(() => server.close());

  return server;
}

function settings(baseUrl: string, authHeader?: string): NodeJS.ProcessEnv {
  return {
    OPENAI_BASE_URL: baseUrl,
    OPENAI_API_KEY: "dummy-key",
    LORE_LLM_PROVIDER: "openai",
    LORE_FACT_MODEL: "chat-deployment",
    LORE_EMBEDDING_PROVIDER: "openai",
    LORE_OPENAI_AUTH_HEADER: authHeader,
  };
}

describe("OpenAI-compatible authentication", () => {
  it("defaults to bearer and reads explicit header modes case-insensitively", () => {
    for (const value of [undefined, "", "bearer", "BeArEr"]) {
      expect(openAiAuthHeader({ LORE_OPENAI_AUTH_HEADER: value })).toBe(
        "bearer",
      );
    }
    expect(openAiAuthHeader({ LORE_OPENAI_AUTH_HEADER: "X-Api-Key" })).toBe(
      "x-api-key",
    );
  });

  it("rejects an invalid header mode only when selecting OpenAI and omits its value", () => {
    const env = { LORE_OPENAI_AUTH_HEADER: "dummy-secret-in-wrong-setting" };
    const error = new Error(
      "LORE_OPENAI_AUTH_HEADER must be bearer or x-api-key",
    );

    expect(() =>
      selectProvider({ ...env, LORE_LLM_PROVIDER: "openai" }),
    ).toThrow(error);
    expect(() =>
      selectEmbeddingProvider({ ...env, LORE_EMBEDDING_PROVIDER: "openai" }),
    ).toThrow(error);
    expect({
      chat: selectProvider({ ...env, LORE_LLM_PROVIDER: "ollama" }).vendor,
      embeddings: selectEmbeddingProvider({
        ...env,
        LORE_EMBEDDING_PROVIDER: "vertex",
      }).vendor,
    }).toEqual({ chat: "ollama", embeddings: "vertex" });
  });

  it("uses x-api-key alone for a named OpenAI chat use and for embeddings", async () => {
    const server = await gateway();
    const env = settings(server.baseUrl, "X-Api-Key");
    const chat = selectProviderFor("eval", {
      ...env,
      LORE_LLM_PROVIDER: "ollama",
      LORE_EVAL_LLM_PROVIDER: "openai",
    });

    expect((await chat.complete({ prompt: "hi" })).text).toBe("answer");
    expect(await selectEmbeddingProvider(env).embed(["hi"])).toEqual([vector]);
    expect(server.requests).toMatchObject([
      { ...keyOnly, url: "/openai/v1/chat/completions" },
      { ...keyOnly, url: "/openai/v1/embeddings" },
    ]);
  });

  it("preserves missing-model and missing-key handling without sending a request", async () => {
    const server = await gateway();
    const env = {
      ...settings(server.baseUrl, "x-api-key"),
      OPENAI_API_KEY: undefined,
    };
    const missingBoth = selectProvider({ ...env, LORE_FACT_MODEL: undefined });

    await expect(missingBoth.complete({ prompt: "hi" })).rejects.toThrow(
      "OpenAI-compatible model not set",
    );
    await expect(
      selectProvider(env).complete({ prompt: "hi" }),
    ).rejects.toThrow("OPENAI_API_KEY not set");
    const vectors = await selectEmbeddingProvider(env).embed(["a", "b"]);

    expect({ vectors, requests: server.requests }).toEqual({
      vectors: [null, null],
      requests: [],
    });
  });

  it("stops both x-api-key requests at a cross-origin 307", async () => {
    const destination = await gateway();
    const origin = await gateway(destination.baseUrl);
    const env = settings(origin.baseUrl, "x-api-key");

    await expect(
      selectProvider(env).complete({ prompt: "hi" }),
    ).rejects.toThrow("OpenAI API error: 307");
    expect(await selectEmbeddingProvider(env).embed(["hi"])).toEqual([null]);
    expect({
      origin: origin.requests,
      destination: destination.requests,
    }).toMatchObject({
      origin: [
        { ...keyOnly, url: "/openai/v1/chat/completions" },
        { ...keyOnly, url: "/openai/v1/embeddings" },
      ],
      destination: [],
    });
  });

  it("retains same-origin redirects with Authorization for chat and embeddings by default", async () => {
    const server = await gateway("/landed");
    const env = settings(server.baseUrl);

    expect((await selectProvider(env).complete({ prompt: "hi" })).text).toBe(
      "answer",
    );
    expect(await selectEmbeddingProvider(env).embed(["hi"])).toEqual([vector]);
    expect(server.requests).toMatchObject([
      { ...bearerOnly, url: "/openai/v1/chat/completions" },
      { ...bearerOnly, url: "/landed/chat/completions" },
      { ...bearerOnly, url: "/openai/v1/embeddings" },
      { ...bearerOnly, url: "/landed/embeddings" },
    ]);
  });
});
