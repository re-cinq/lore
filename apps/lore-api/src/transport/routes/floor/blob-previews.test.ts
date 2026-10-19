import Hapi from "@hapi/hapi";
import { describe, expect, it } from "vitest";
import { blobPreviewsRoute, type BlobPreviewsOf } from "./blob-previews.js";

const ISSUE = `sha256-${"a".repeat(64)}`;
const PLAN = `sha256-${"c".repeat(64)}`;
const PREVIEW = {
  hash: ISSUE,
  contentType: "text/markdown",
  size: 12,
  text: "# the issue\n",
  truncated: false,
} as const;

function serve(previewsOf: BlobPreviewsOf) {
  const server = Hapi.server();

  server.auth.scheme("stub", () => ({
    authenticate: (_r, h) => h.authenticated({ credentials: {} }),
  }));
  server.auth.strategy("bearer-scope", "stub");
  server.auth.default("bearer-scope");
  server.route(blobPreviewsRoute(previewsOf));

  return server;
}

function asking() {
  const asked: unknown[] = [];
  const previewsOf: BlobPreviewsOf = async (...args) => {
    asked.push(args);

    return { [ISSUE]: PREVIEW };
  };

  return { asked, previewsOf };
}

describe("GET /api/assembly-runs/{id}/blob-previews", () => {
  it("answers the previews of the issue and plan hashes asked of run-1", async () => {
    const { asked, previewsOf } = asking();
    const res = await serve(previewsOf).inject(
      `/api/assembly-runs/run-1/blob-previews?hash=${ISSUE}&hash=${PLAN}`,
    );

    expect({ status: res.statusCode, body: res.result, asked }).toEqual({
      status: 200,
      body: { previews: { [ISSUE]: PREVIEW } },
      asked: [["run-1", [ISSUE, PLAN]]],
    });
  });

  it("takes one hash given once as a list of one", async () => {
    const { asked, previewsOf } = asking();

    await serve(previewsOf).inject(
      `/api/assembly-runs/run-1/blob-previews?hash=${ISSUE}`,
    );

    expect(asked).toEqual([["run-1", [ISSUE]]]);
  });

  it("answers 400 for 51 hashes without asking", async () => {
    const { asked, previewsOf } = asking();
    const query = Array.from({ length: 51 }, () => `hash=${ISSUE}`).join("&");
    const res = await serve(previewsOf).inject(
      `/api/assembly-runs/run-1/blob-previews?${query}`,
    );

    expect({ status: res.statusCode, asked }).toEqual({
      status: 400,
      asked: [],
    });
  });

  it("answers 400 for a hash that is not sha256-<64 hex> without asking", async () => {
    const { asked, previewsOf } = asking();
    const res = await serve(previewsOf).inject(
      "/api/assembly-runs/run-1/blob-previews?hash=..%2Fsecrets",
    );

    expect({ status: res.statusCode, asked }).toEqual({
      status: 400,
      asked: [],
    });
  });

  it("answers 404 for a run the floor does not have", async () => {
    const res = await serve(async () => null).inject(
      `/api/assembly-runs/run-9/blob-previews?hash=${ISSUE}`,
    );

    expect(res.statusCode).toBe(404);
  });
});
