import { beforeEach, describe, expect, it } from "vitest";
import { OpenAiEmbeddingProvider } from "./openai-embedding-provider.js";
import { embeddingHealth, resetEmbeddingHealth } from "./embedding-health.js";

interface RecordedRequest {
  url: string;
  headers: Record<string, string>;
  body: { model: string; input: string[]; dimensions: number };
}

const BASE_URL = "https://res.openai.azure.com/openai/v1";

function vectorOf(width: number, fill: number): number[] {
  return Array.from({ length: width }, () => fill);
}

function echoingLengths(requests: RecordedRequest[] = []): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));

    requests.push({
      url: String(url),
      headers: init.headers as Record<string, string>,
      body,
    });

    return new Response(
      JSON.stringify({
        data: (body.input as string[])
          .map((text, index) => ({
            index,
            embedding: vectorOf(768, text.length),
          }))
          .reverse(),
      }),
    );
  }) as typeof fetch;
}

function answering(reply: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(reply), { status })) as typeof fetch;
}

function neverCalled(): typeof fetch {
  return (async () => {
    throw new Error("fetch must not be called");
  }) as typeof fetch;
}

beforeEach(() => resetEmbeddingHealth());

describe("OpenAiEmbeddingProvider", () => {
  it("reports vendor openai, 768 dimensions and model text-embedding-3-small by default", () => {
    const provider = new OpenAiEmbeddingProvider({ apiKey: "k" });

    expect({
      vendor: provider.vendor,
      dimensions: provider.dimensions,
      model: provider.model,
    }).toEqual({
      vendor: "openai",
      dimensions: 768,
      model: "text-embedding-3-small",
    });
  });

  it("posts model, both inputs and dimensions 768 to /embeddings with the bearer key, and returns the vectors in input order", async () => {
    const requests: RecordedRequest[] = [];
    const provider = new OpenAiEmbeddingProvider({
      apiKey: "k1",
      baseUrl: `${BASE_URL}/`,
      model: "emb-deployment",
      fetchFn: echoingLengths(requests),
    });

    const vectors = await provider.embed(["a", "bbb"]);

    expect(requests).toEqual([
      {
        url: `${BASE_URL}/embeddings`,
        headers: {
          Authorization: "Bearer k1",
          "Content-Type": "application/json",
        },
        body: {
          model: "emb-deployment",
          input: ["a", "bbb"],
          dimensions: 768,
        },
      },
    ]);
    expect(vectors.map((vector) => vector?.[0])).toEqual([1, 3]);
    expect(embeddingHealth()).toMatchObject({
      lastOkAt: expect.any(String),
      consecutiveFailures: 0,
    });
  });

  it("cuts a 9000-char text to 8000 chars before sending", async () => {
    const requests: RecordedRequest[] = [];
    const provider = new OpenAiEmbeddingProvider({
      apiKey: "k",
      fetchFn: echoingLengths(requests),
    });

    await provider.embed(["x".repeat(9000)]);

    expect(requests[0].body.input[0]).toHaveLength(8000);
  });

  it("sends 251 short texts as two calls of 250 and 1 and keeps the order", async () => {
    const requests: RecordedRequest[] = [];
    const provider = new OpenAiEmbeddingProvider({
      apiKey: "k",
      fetchFn: echoingLengths(requests),
    });
    const texts = Array.from({ length: 251 }, (_, i) => "t".repeat(i + 1));

    const vectors = await provider.embed(texts);

    expect({
      batches: requests.map((request) => request.body.input.length),
      lengths: vectors.map((vector) => vector?.[0]),
    }).toEqual({
      batches: [250, 1],
      lengths: texts.map((text) => text.length),
    });
  });

  it("returns nulls without calling out and records a failure with status null when there is no key", async () => {
    const provider = new OpenAiEmbeddingProvider({ fetchFn: neverCalled() });

    expect(await provider.embed(["a", "b"])).toEqual([null, null]);
    expect(embeddingHealth()).toMatchObject({
      lastStatus: null,
      consecutiveFailures: 1,
    });
  });

  it("returns nulls for the batch and records status 429 on a non-ok reply", async () => {
    const provider = new OpenAiEmbeddingProvider({
      apiKey: "k",
      fetchFn: answering({ error: "rate" }, 429),
    });

    expect(await provider.embed(["a", "b"])).toEqual([null, null]);
    expect(embeddingHealth()).toMatchObject({
      lastStatus: 429,
      consecutiveFailures: 1,
    });
  });

  it("returns nulls and records a failure when the reply holds one vector for two texts", async () => {
    const provider = new OpenAiEmbeddingProvider({
      apiKey: "k",
      fetchFn: answering({
        data: [{ index: 0, embedding: vectorOf(768, 1) }],
      }),
    });

    expect(await provider.embed(["a", "b"])).toEqual([null, null]);
    expect(embeddingHealth().consecutiveFailures).toBe(1);
  });

  it("returns nulls and records a failure when a vector is 1536 wide instead of 768", async () => {
    const provider = new OpenAiEmbeddingProvider({
      apiKey: "k",
      fetchFn: answering({
        data: [{ index: 0, embedding: vectorOf(1536, 1) }],
      }),
    });

    expect(await provider.embed(["a"])).toEqual([null]);
    expect(embeddingHealth().consecutiveFailures).toBe(1);
  });

  it("posts the same body to /embeddings with the key only in x-api-key when built with authHeader x-api-key, and returns the vectors in input order", async () => {
    const requests: RecordedRequest[] = [];
    const provider = new OpenAiEmbeddingProvider({
      apiKey: "dummy-key",
      baseUrl: BASE_URL,
      authHeader: "x-api-key",
      model: "emb-deployment",
      fetchFn: echoingLengths(requests),
    });

    const firstBatch = Array<string>(250).fill("a");
    const inputs = [...firstBatch, "bbb"];
    const vectors = await provider.embed(inputs);

    expect(requests).toEqual(
      [firstBatch, ["bbb"]].map((input) => ({
        url: `${BASE_URL}/embeddings`,
        headers: {
          "x-api-key": "dummy-key",
          "Content-Type": "application/json",
        },
        body: {
          model: "emb-deployment",
          input,
          dimensions: 768,
        },
      })),
    );
    expect(vectors.map((vector) => vector?.[0])).toEqual(
      inputs.map((text) => text.length),
    );
  });
});
