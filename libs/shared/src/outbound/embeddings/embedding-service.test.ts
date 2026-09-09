import { enforceTrue } from "../../lib/enforce.js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildVertexUrl,
  resolveVertexProject,
  resetVertexProjectCache,
  getQueryEmbedding,
  embeddingHealth,
  embedderDegraded,
  resetEmbeddingHealth,
} from "./embedding-service.js";

const SAVED = { ...process.env };

beforeEach(() => {
  resetVertexProjectCache();
  delete process.env.GCP_PROJECT;
  delete process.env.GOOGLE_CLOUD_PROJECT;
  delete process.env.GOOGLE_ACCESS_TOKEN;
});
afterEach(() => {
  process.env = { ...SAVED };
  vi.unstubAllGlobals();
  resetVertexProjectCache();
});

describe("buildVertexUrl", () => {
  it("interpolates project and region into the predict endpoint", () => {
    expect(buildVertexUrl("my-gcp-project", "europe-west1")).toBe(
      "https://europe-west1-aiplatform.googleapis.com/v1/projects/my-gcp-project/locations/europe-west1/publishers/google/models/text-embedding-005:predict",
    );
  });
});

describe("resolveVertexProject", () => {
  it("returns GCP_PROJECT from the environment without hitting the metadata server", async () => {
    process.env.GCP_PROJECT = "proj-from-env";
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);
    expect(await resolveVertexProject()).toBe("proj-from-env");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the GKE metadata server project-id when env is unset", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/project/project-id")
          ? ({ ok: true, text: async () => "proj-from-metadata\n" } as Response)
          : ({ ok: false } as Response),
      ),
    );
    expect(await resolveVertexProject()).toBe("proj-from-metadata");
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
