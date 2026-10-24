import { describe, it, expect } from "vitest";
import Hapi from "@hapi/hapi";
import { ingestDeltaRoute } from "./ingest-delta.js";
import { defaultDeps } from "./ingest-delta-deps.js";

async function serverWith(queries: { sql: string; params: unknown[] }[]) {
  const server = Hapi.server();

  server.auth.scheme("stub", () => ({
    authenticate: (_request: unknown, h: any) =>
      h.authenticated({ credentials: {} }),
  }));
  server.auth.strategy("bearer-scope", "stub");
  server.auth.default("bearer-scope");

  const pool = {
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });

      return { rows: [{ id: "1" }] };
    },
  } as never;

  const deps = {
    ...defaultDeps(),
    dgraph: () => ({ mutate: async () => undefined }),
    ingestReport: async () => ({ testChunks: 1 }),
    pruneTests: async () => ({ prunedChunks: 0 }),
    defaultBranch: async () => "main",
    markIngested: async () => undefined,
  } as any;

  server.route(ingestDeltaRoute(() => pool, deps));

  return server;
}

describe("Test report ingest (acceptance)", () => {
  it("keeps the test report lore-code-trace posts as the branch's latest", async () => {
    const queries: { sql: string; params: unknown[] }[] = [];
    const server = await serverWith(queries);

    const res = await server.inject({
      method: "POST",
      url: "/api/repos/org/repo/ingest",
      payload: {
        kind: "test-report",
        commit: "a".repeat(40),
        base_commit: null,
        report: {
          branch: "feature/foo",
          tests: [{ id: "test-id", name: "test-name", file: "test-file.ts" }],
          outcomes: { "test-id": true },
        },
      },
    });

    expect(res.statusCode).toBe(200);

    const upsert = queries.find((q) => q.sql.includes("pipeline.test_reports"));

    expect(upsert).toBeDefined();
    expect(upsert?.params).toContain("feature/foo");
  });

  it("keeps a posted report that names no branch as no row", async () => {
    const queries: { sql: string; params: unknown[] }[] = [];
    const server = await serverWith(queries);

    const res = await server.inject({
      method: "POST",
      url: "/api/repos/org/repo/ingest",
      payload: {
        kind: "test-report",
        commit: "a".repeat(40),
        base_commit: null,
        report: {
          tests: [{ id: "test-id", name: "test-name", file: "test-file.ts" }],
          outcomes: { "test-id": true },
        },
      },
    });

    expect(res.statusCode).toBe(200);

    const upsert = queries.find((q) => q.sql.includes("pipeline.test_reports"));

    expect(upsert).toBeUndefined();
  });
});
