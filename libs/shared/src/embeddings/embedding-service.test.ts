import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildVertexUrl,
  resolveVertexProject,
  resetVertexProjectCache,
  getQueryEmbedding,
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

describe("getQueryEmbedding project resolution", () => {
  it("returns null (never builds a projects// URL) when no project can be resolved", async () => {
    process.env.GOOGLE_ACCESS_TOKEN = "tok"; // token available…
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("service-accounts/default/token"))
        throw new Error("no metadata");
      if (url.includes("/project/project-id")) return { ok: false } as Response; // …but no project
      return {
        ok: true,
        json: async () => ({ predictions: [{ embeddings: { values: [1] } }] }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getQueryEmbedding("hello");
    expect(result).toBeNull();
    // The malformed-URL bug: a predict call with an empty project must never fire.
    expect(
      fetchMock.mock.calls.some(([u]) =>
        String(u).includes("projects//locations"),
      ),
    ).toBe(false);
  });
});
