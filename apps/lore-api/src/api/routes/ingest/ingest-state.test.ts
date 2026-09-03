import { describe, it, expect } from "vitest";
import Hapi from "@hapi/hapi";
import { ingestStateRoute } from "./ingest-state.js";

function poolWith(
  rows: unknown[],
  issued: Array<{ sql: string; params: unknown[] }> = [],
) {
  return {
    query: async (sql: string, params: unknown[] = []) => {
      issued.push({ sql, params });

      return { rows };
    },
  } as never;
}

async function serverWith(
  rows: unknown[],
  issued: Array<{ sql: string; params: unknown[] }> = [],
) {
  const server = Hapi.server();

  server.auth.scheme("stub", () => ({
    authenticate: (_request, h) => h.authenticated({ credentials: {} }),
  }));
  server.auth.strategy("bearer-scope", "stub");
  server.auth.default("bearer-scope");
  server.route(ingestStateRoute(() => poolWith(rows, issued)));

  return server;
}

describe("GET /api/repos/{owner}/{repo}/ingest-state", () => {
  it("returns the stored commit for the repo and kind", async () => {
    const issued: Array<{ sql: string; params: unknown[] }> = [];
    const server = await serverWith(
      [{ commit_sha: "c0ffee0000000000000000000000000000000000" }],
      issued,
    );
    const res = await server.inject({
      method: "GET",
      url: "/api/repos/re-cinq/lore/ingest-state?kind=test-report",
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({
      kind: "test-report",
      commit: "c0ffee0000000000000000000000000000000000",
    });
    expect(issued[0].params).toEqual(["re-cinq/lore", "test-report"]);
  });

  it("returns a null commit when nothing was ever ingested — the full-ingest signal", async () => {
    const res = await (
      await serverWith([])
    ).inject({
      method: "GET",
      url: "/api/repos/re-cinq/lore/ingest-state?kind=specs",
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ kind: "specs", commit: null });
  });

  it("rejects an unknown kind as a 400 naming the valid set", async () => {
    const res = await (
      await serverWith([])
    ).inject({
      method: "GET",
      url: "/api/repos/re-cinq/lore/ingest-state?kind=everything",
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).error).toContain("test-report");
  });

  it("survives an unmigrated cluster by answering null instead of 500", async () => {
    const pool = {
      query: async () =>
        Promise.reject(
          Object.assign(new Error("no such table"), { code: "42P01" }),
        ),
    } as never;
    const server = Hapi.server();

    server.auth.scheme("stub", () => ({
      authenticate: (_request, h) => h.authenticated({ credentials: {} }),
    }));
    server.auth.strategy("bearer-scope", "stub");
    server.auth.default("bearer-scope");
    server.route(ingestStateRoute(() => pool));

    const res = await server.inject({
      method: "GET",
      url: "/api/repos/re-cinq/lore/ingest-state?kind=adrs",
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ kind: "adrs", commit: null });
  });
});
