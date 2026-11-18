import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { describe, it, expect, vi } from "vitest";
import Hapi from "@hapi/hapi";
import { ingestDeltaRoute, type IngestDeltaDeps } from "./ingest-delta.js";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function fakeDeps(): any {
  const calls: Array<[string, ...unknown[]]> = [];
  const recordProjection =
    (name: string) =>
    async (repo: any, path: any, content: any, projection: any) => {
      calls.push([
        name,
        repo,
        path,
        content,
        ...(projection.force ? ["forced"] : []),
      ]);

      return { projected: true };
    };

  return {
    calls,
    dgraph: () => ({}),
    projectSpec: recordProjection("projectSpec"),
    projectAdr: recordProjection("projectAdr"),
    projectCode: recordProjection("projectCode"),
    listSpecs: async () => [],
    listAdrs: async () => [],
    listCode: async () => [],
    deleteSpec: async () => {},
    deleteAdr: async () => {},
    deleteCode: async () => {},
    markIngested: async () => {},
    mirrorDoc: async () => {},
    unmirrorDoc: async () => {},
    mirrorCode: async () => {},
    unmirrorCode: async () => {},
  };
}

async function serverWith(deps: any) {
  const server = Hapi.server();

  server.auth.scheme("stub", () => ({
    authenticate: (_request: any, h: any) =>
      h.authenticated({ credentials: {} }),
  }));
  server.auth.strategy("bearer-scope", "stub");
  server.auth.default("bearer-scope");

  const pool = {
    query: async () => ({ rows: [{ commit_sha: SHA_A }], rowCount: 1 }),
  } as never;

  server.route(ingestDeltaRoute(() => pool, deps as IngestDeltaDeps));

  return server;
}

const post = (server: Hapi.Server, payload: Record<string, unknown>) =>
  server.inject({
    method: "POST",
    url: "/api/repos/re-cinq/lore/ingest",
    payload,
  });

describe("POST /api/repos/{owner}/{repo}/ingest acceptance", () => {
  it("projects later files in a batch even if an earlier file fails", async () => {
    const deps = fakeDeps();

    deps.projectSpec = vi
      .fn()
      .mockImplementation(async (repo, path, content, _projection) => {
        deps.calls.push(["projectSpec", repo, path, content]);
        enforceTrue(
          path !== "specs/bad/spec.md",
          Error,
          "projection failed for bad file",
        );

        return { projected: true };
      });

    const server = await serverWith(deps);

    const res = await post(server, {
      kind: "specs",
      commit: SHA_B,
      base_commit: SHA_A,
      files: [
        { path: "specs/good-1/spec.md", content: "good 1" },
        { path: "specs/bad/spec.md", content: "bad" },
        { path: "specs/good-2/spec.md", content: "good 2" },
      ],
    });

    const pathsAttempted = deps.calls
      .filter((c: any) => c[0] === "projectSpec")
      .map((c: any) => c[2]);

    expect(pathsAttempted).toEqual([
      "specs/good-1/spec.md",
      "specs/bad/spec.md",
      "specs/good-2/spec.md",
    ]);

    expect(res.statusCode).toBe(500);
  });
});
