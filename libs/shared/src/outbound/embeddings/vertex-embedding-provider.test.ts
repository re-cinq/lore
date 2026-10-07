import { enforceTrue } from "../../lib/enforce.js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildVertexUrl,
  embeddingBatches,
  VertexEmbeddingProvider,
} from "./vertex-embedding-provider.js";
import { embeddingHealth, resetEmbeddingHealth } from "./embedding-health.js";
import { resetGoogleProjectCache } from "../google/access-token.js";

const SAVED = { ...process.env };

beforeEach(() => {
  resetGoogleProjectCache();
  resetEmbeddingHealth();
  delete process.env.GCP_PROJECT;
  delete process.env.GOOGLE_CLOUD_PROJECT;
  delete process.env.GOOGLE_ACCESS_TOKEN;
});
afterEach(() => {
  process.env = { ...SAVED };
  vi.unstubAllGlobals();
  resetGoogleProjectCache();
});

describe("buildVertexUrl", () => {
  it("interpolates project and region into the predict endpoint", () => {
    expect(buildVertexUrl("my-gcp-project", "europe-west1")).toBe(
      "https://europe-west1-aiplatform.googleapis.com/v1/projects/my-gcp-project/locations/europe-west1/publishers/google/models/text-embedding-005:predict",
    );
  });
});

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

describe("VertexEmbeddingProvider", () => {
  const vertexEchoingLengths = () =>
    vi.fn(async (url: string, init?: RequestInit) => {
      enforceTrue(
        !url.includes("service-accounts/default/token"),
        Error,
        "no metadata",
      );
      const { instances } = JSON.parse(String(init?.body)) as {
        instances: Array<{ content: string }>;
      };

      return {
        ok: true,
        status: 200,
        json: async () => ({
          predictions: instances.map((instance) => ({
            embeddings: { values: [instance.content.length] },
          })),
        }),
      } as Response;
    });

  it("reports vendor vertex, model text-embedding-005 and dimensions 768", () => {
    expect(new VertexEmbeddingProvider()).toMatchObject({
      vendor: "vertex",
      model: "text-embedding-005",
      dimensions: 768,
    });
  });

  it("returns null for both texts without calling Vertex when there is no token", async () => {
    const fetchMock = vertexEchoingLengths();

    vi.stubGlobal("fetch", fetchMock);
    process.env.GCP_PROJECT = "proj";

    expect(await new VertexEmbeddingProvider().embed(["a", "b"])).toEqual([
      null,
      null,
    ]);
    expect(
      fetchMock.mock.calls.filter(([url]) => url.includes(":predict")),
    ).toHaveLength(0);
  });

  it("records a call with no token as a failure with lastStatus null", async () => {
    vi.stubGlobal("fetch", vertexEchoingLengths());

    await new VertexEmbeddingProvider().embed(["a"]);

    expect(embeddingHealth()).toMatchObject({
      lastStatus: null,
      consecutiveFailures: 1,
    });
  });

  it("embeds 'a' and 'bbb' as vectors 1 and 3 with the env token and project, and records an ok outcome", async () => {
    process.env.GOOGLE_ACCESS_TOKEN = "tok";
    process.env.GCP_PROJECT = "proj";
    vi.stubGlobal("fetch", vertexEchoingLengths());

    expect(await new VertexEmbeddingProvider().embed(["a", "bbb"])).toEqual([
      [1],
      [3],
    ]);
    expect(embeddingHealth()).toMatchObject({
      lastOkAt: expect.any(String),
      consecutiveFailures: 0,
    });
  });
});
