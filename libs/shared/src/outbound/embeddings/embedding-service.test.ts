import { enforceTrue } from "../../lib/enforce.js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildVertexUrl,
  getQueryEmbedding,
  getQueryEmbeddings,
  embeddingBatches,
  embeddingHealth,
  embedderDegraded,
  resetEmbeddingHealth,
} from "./embedding-service.js";
import { resetGoogleProjectCache } from "../google/access-token.js";

const SAVED = { ...process.env };

beforeEach(() => {
  resetGoogleProjectCache();
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

describe("embeddingHealth", () => {
  const vertexAnswering = (status: number) =>
    vi.fn(async (url: string) => {
      enforceTrue(
        !url.includes("service-accounts/default/token"),
        Error,
        "no metadata",
      );

      return status === 200
        ? ({
            ok: true,
            status,
            json: async () => ({
              predictions: [{ embeddings: { values: [0.1] } }],
            }),
          } as Response)
        : ({ ok: false, status } as Response);
    });

  beforeEach(() => {
    resetEmbeddingHealth();
    process.env.GOOGLE_ACCESS_TOKEN = "tok";
    process.env.GCP_PROJECT = "proj";
  });

  it("reports consecutiveFailures 2 and lastStatus 403 after two 403 responses", async () => {
    vi.stubGlobal("fetch", vertexAnswering(403));

    await getQueryEmbedding("a");
    await getQueryEmbedding("b");

    expect(embeddingHealth()).toEqual({
      lastOkAt: null,
      lastFailureAt: expect.any(String),
      lastStatus: 403,
      consecutiveFailures: 2,
    });
  });

  it("is degraded after 3 failures and healthy again with consecutiveFailures 0 after one 200", async () => {
    vi.stubGlobal("fetch", vertexAnswering(403));
    await getQueryEmbedding("a");
    await getQueryEmbedding("b");
    await getQueryEmbedding("c");
    const degradedAtThree = embedderDegraded();

    vi.stubGlobal("fetch", vertexAnswering(200));
    await getQueryEmbedding("d");

    expect({ degradedAtThree, after: embeddingHealth() }).toEqual({
      degradedAtThree: true,
      after: {
        lastOkAt: expect.any(String),
        lastFailureAt: expect.any(String),
        lastStatus: 403,
        consecutiveFailures: 0,
      },
    });
  });

  it("counts a call that never reached Vertex (no credential) as a failure with lastStatus null", async () => {
    delete process.env.GOOGLE_ACCESS_TOKEN;
    vi.stubGlobal("fetch", vertexAnswering(200));

    await getQueryEmbedding("a");

    expect(embeddingHealth()).toMatchObject({
      lastStatus: null,
      consecutiveFailures: 1,
    });
  });
});

describe("getQueryEmbedding project resolution", () => {
  it("returns null (never builds a projects// URL) when no project can be resolved", async () => {
    process.env.GOOGLE_ACCESS_TOKEN = "tok";
    const fetchMock = vi.fn(async (url: string) => {
      enforceTrue(
        !url.includes("service-accounts/default/token"),
        Error,
        "no metadata",
      );

      if (url.includes("/project/project-id")) {
        return { ok: false } as Response;
      }

      return {
        ok: true,
        json: async () => ({ predictions: [{ embeddings: { values: [1] } }] }),
      } as Response;
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await getQueryEmbedding("hello");

    expect(result).toBeNull();
    expect(
      fetchMock.mock.calls.some(([u]) =>
        String(u).includes("projects//locations"),
      ),
    ).toBe(false);
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

describe("getQueryEmbeddings", () => {
  const vertexEchoingIndexes = () =>
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

  beforeEach(() => {
    resetEmbeddingHealth();
    process.env.GOOGLE_ACCESS_TOKEN = "tok";
    process.env.GCP_PROJECT = "p";
  });

  it("embeds three texts in one Vertex call and returns the vectors in input order", async () => {
    const fetchMock = vertexEchoingIndexes();

    vi.stubGlobal("fetch", fetchMock);

    expect(await getQueryEmbeddings(["a", "bb", "ccc"])).toEqual([
      [1],
      [2],
      [3],
    ]);
    expect(
      fetchMock.mock.calls.filter(([url]) => url.includes(":predict")),
    ).toHaveLength(1);
  });

  it("returns null for every text when Vertex answers 403", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 403 }) as Response),
    );

    expect(await getQueryEmbeddings(["a", "b"])).toEqual([null, null]);
    expect(embeddingHealth()).toMatchObject({ lastStatus: 403 });
  });

  it("returns an empty list for no texts without calling Vertex", async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);

    expect(await getQueryEmbeddings([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
