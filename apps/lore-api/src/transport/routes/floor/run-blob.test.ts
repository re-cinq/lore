import Hapi from "@hapi/hapi";
import { describe, expect, it } from "vitest";
import { runBlobRoute, type RunBlobOf } from "./run-blob.js";

const HASH = `sha256-${"a".repeat(64)}`;
const BLOB = {
  hash: HASH,
  contentType: "text/markdown",
  size: 12,
  text: "# the issue\n",
  truncated: false,
} as const;

function serve(blobOf: RunBlobOf) {
  const server = Hapi.server();

  server.auth.scheme("stub", () => ({
    authenticate: (_r, h) => h.authenticated({ credentials: {} }),
  }));
  server.auth.strategy("bearer-scope", "stub");
  server.auth.default("bearer-scope");
  server.route(runBlobRoute(blobOf));

  return server;
}

describe("GET /api/assembly-runs/{id}/blobs/{hash}", () => {
  it("answers the blob run-1 holds under the hash", async () => {
    const asked: unknown[] = [];
    const server = serve(async (...args) => {
      asked.push(args);

      return BLOB;
    });
    const res = await server.inject(`/api/assembly-runs/run-1/blobs/${HASH}`);

    expect({ status: res.statusCode, body: res.result, asked }).toEqual({
      status: 200,
      body: BLOB,
      asked: [["run-1", HASH]],
    });
  });

  it("answers 404 for a blob the run does not reference", async () => {
    const res = await serve(async () => null).inject(
      `/api/assembly-runs/run-1/blobs/${HASH}`,
    );

    expect(res.statusCode).toBe(404);
  });

  it("answers 400 for a hash that is not sha256-<64 hex> without asking", async () => {
    const asked: unknown[] = [];
    const res = await serve(async (...args) => {
      asked.push(args);

      return BLOB;
    }).inject("/api/assembly-runs/run-1/blobs/..%2Fsecrets");

    expect({ status: res.statusCode, asked }).toEqual({
      status: 400,
      asked: [],
    });
  });
});
