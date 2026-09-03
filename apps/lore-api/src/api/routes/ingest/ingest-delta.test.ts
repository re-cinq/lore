import { describe, it, expect, vi } from "vitest";
import Hapi from "@hapi/hapi";
import { ingestDeltaRoute, type IngestDeltaDeps } from "./ingest-delta.js";

/**
 * The incremental CI ingest sink (specs/ci-incremental-ingest FR3): CI diffs
 * against the last-ingested commit and POSTs only the delta as JSON — changed
 * doc contents, an incremental test report, and the deleted paths — which this
 * route projects in-process and then advances the stored commit with a
 * compare-and-set. No pods, no events: the graph write happens here.
 */

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

interface Issued {
  sql: string;
  params: unknown[];
}

function poolWith(resultsBySql: Array<[RegExp, unknown[]]>, issued: Issued[]) {
  return {
    query: async (sql: string, params: unknown[] = []) => {
      issued.push({ sql, params });
      const match = resultsBySql.find(([re]) => re.test(sql));

      return { rows: match ? match[1] : [], rowCount: match?.[1].length ?? 0 };
    },
  } as never;
}

function fakeDeps(): IngestDeltaDeps & {
  calls: Array<[string, ...unknown[]]>;
} {
  const calls: Array<[string, ...unknown[]]> = [];

  return {
    calls,
    dgraph: () => ({}) as never,
    projectSpec: async (repo, path, content) => {
      calls.push(["projectSpec", repo, path, content]);

      return { projected: true };
    },
    projectAdr: async (repo, path, content) => {
      calls.push(["projectAdr", repo, path, content]);

      return { projected: true };
    },
    deleteSpec: async (repo, path) => {
      calls.push(["deleteSpec", repo, path]);
    },
    deleteAdr: async (repo, path) => {
      calls.push(["deleteAdr", repo, path]);
    },
    ingestReport: async (repo, payload) => {
      calls.push(["ingestReport", repo, payload]);

      return {
        kind: "test-report",
        testChunks: 2,
        validatedBy: 1,
        violated: 0,
        coverageNodes: 1,
        coversEdges: 1,
      };
    },
    pruneTests: async (repo, files) => {
      calls.push(["pruneTests", repo, files]);

      return { prunedChunks: files.length };
    },
  };
}

async function serverWith(
  deps: IngestDeltaDeps,
  resultsBySql: Array<[RegExp, unknown[]]> = [],
  issued: Issued[] = [],
) {
  const server = Hapi.server();

  server.auth.scheme("stub", () => ({
    authenticate: (_request, h) => h.authenticated({ credentials: {} }),
  }));
  server.auth.strategy("bearer-scope", "stub");
  server.auth.default("bearer-scope");
  server.route(ingestDeltaRoute(() => poolWith(resultsBySql, issued), deps));

  return server;
}

const post = (server: Hapi.Server, payload: Record<string, unknown>) =>
  server.inject({
    method: "POST",
    url: "/api/repos/re-cinq/lore/ingest",
    payload,
  });

/** The stored state matches the posted base → the pre-check reads the base
 *  back and the CAS insert/update reports 1 row. */
const casAdvances: Array<[RegExp, unknown[]]> = [
  [/INSERT INTO pipeline\.ingest_state/, [{ commit_sha: SHA_B }]],
  [/SELECT commit_sha/, [{ commit_sha: SHA_A }]],
];

/** No stored state at all — the base-null full-ingest case. */
const casFirstIngest: Array<[RegExp, unknown[]]> = [
  [/INSERT INTO pipeline\.ingest_state/, [{ commit_sha: SHA_B }]],
];

describe("POST /api/repos/{owner}/{repo}/ingest", () => {
  it("projects changed docs, prunes deleted ones, and advances the state", async () => {
    const deps = fakeDeps();
    const issued: Issued[] = [];
    const server = await serverWith(deps, casAdvances, issued);
    const res = await post(server, {
      kind: "specs",
      commit: SHA_B,
      base_commit: SHA_A,
      files: [
        { path: "specs/x/spec.md", content: "# Feature Specification: X\n" },
      ],
      deleted: ["specs/old/spec.md"],
    });
    const body = JSON.parse(res.payload);

    expect(res.statusCode).toBe(200);
    expect(deps.calls).toEqual([
      [
        "projectSpec",
        "re-cinq/lore",
        "specs/x/spec.md",
        "# Feature Specification: X\n",
      ],
      ["deleteSpec", "re-cinq/lore", "specs/old/spec.md"],
    ]);
    expect(body).toMatchObject({
      kind: "specs",
      commit: SHA_B,
      state: "advanced",
      projected: 1,
      deleted: 1,
    });
  });

  it("routes adr files to the adr projector and adr deletions to the adr prune", async () => {
    const deps = fakeDeps();
    const server = await serverWith(deps, casFirstIngest);

    await post(server, {
      kind: "adrs",
      commit: SHA_B,
      base_commit: null,
      files: [{ path: "adrs/ADR-001.md", content: "# ADR-001\n" }],
      deleted: ["adrs/ADR-000.md"],
    });

    expect(deps.calls).toEqual([
      ["projectAdr", "re-cinq/lore", "adrs/ADR-001.md", "# ADR-001\n"],
      ["deleteAdr", "re-cinq/lore", "adrs/ADR-000.md"],
    ]);
  });

  it("hands a test-report delta to the report ingester and prunes its deleted files", async () => {
    const deps = fakeDeps();
    const server = await serverWith(deps, casAdvances);
    const report = {
      commit: SHA_B,
      tests: [{ id: "a.test.ts::t", name: "t", file: "a.test.ts" }],
      results: [{ id: "a.test.ts::t", passed: true, covered: [] }],
    };
    const res = await post(server, {
      kind: "test-report",
      commit: SHA_B,
      base_commit: SHA_A,
      report,
      deleted: ["gone.test.ts"],
    });

    expect(res.statusCode).toBe(200);
    expect(deps.calls).toEqual([
      ["ingestReport", "re-cinq/lore", report],
      ["pruneTests", "re-cinq/lore", ["gone.test.ts"]],
    ]);
    expect(JSON.parse(res.payload)).toMatchObject({
      test_chunks: 2,
      pruned_test_files: 1,
    });
  });

  it("refuses a stale base with a 409 naming the current commit, and projects nothing", async () => {
    // Two merges raced: this POST diffed from a base the state has already
    // moved past. Projecting the delta anyway could skip the other merge's
    // changes forever — CI must re-fetch the state and re-diff.
    const deps = fakeDeps();
    const server = await serverWith(deps, [
      [/INSERT INTO pipeline\.ingest_state/, []],
      [/SELECT commit_sha/, [{ commit_sha: SHA_B }]],
    ]);
    const res = await post(server, {
      kind: "specs",
      commit: "c".repeat(40),
      base_commit: SHA_A,
      files: [{ path: "specs/x/spec.md", content: "x" }],
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.payload)).toMatchObject({ current: SHA_B });
    expect(deps.calls).toEqual([]);
  });

  it("advances the state only on the final chunk of a chunked ingest", async () => {
    const deps = fakeDeps();
    const issued: Issued[] = [];
    const server = await serverWith(deps, casAdvances, issued);
    const first = await post(server, {
      kind: "test-report",
      commit: SHA_B,
      base_commit: SHA_A,
      seq: 1,
      total: 2,
      report: { commit: SHA_B, tests: [], results: [] },
    });

    expect(JSON.parse(first.payload)).toMatchObject({
      state: "pending-chunks",
    });
    expect(issued.some((q) => /ingest_state/.test(q.sql))).toBe(false);

    const last = await post(server, {
      kind: "test-report",
      commit: SHA_B,
      base_commit: SHA_A,
      seq: 2,
      total: 2,
      report: { commit: SHA_B, tests: [], results: [] },
    });

    expect(JSON.parse(last.payload)).toMatchObject({ state: "advanced" });
    expect(issued.some((q) => /ingest_state/.test(q.sql))).toBe(true);
  });

  it("rejects an unknown kind and a malformed commit as 400s", async () => {
    const server = await serverWith(fakeDeps());

    expect(
      (
        await post(server, {
          kind: "everything",
          commit: SHA_B,
          base_commit: null,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await post(server, {
          kind: "specs",
          commit: "not-a-sha",
          base_commit: null,
        })
      ).statusCode,
    ).toBe(400);
  });

  it("returns 503 with a clear message when no graph store is configured", async () => {
    const deps = { ...fakeDeps(), dgraph: () => null };
    const res = await post(await serverWith(deps), {
      kind: "specs",
      commit: SHA_B,
      base_commit: null,
      files: [],
    });

    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.payload).error).toContain("LORE_DGRAPH_HTTP");
  });

  it("a projection failure surfaces as a 500 and leaves the state unadvanced", async () => {
    const deps = fakeDeps();

    deps.projectSpec = vi.fn().mockRejectedValue(new Error("dgraph down"));
    const issued: Issued[] = [];
    const server = await serverWith(deps, casAdvances, issued);
    const res = await post(server, {
      kind: "specs",
      commit: SHA_B,
      base_commit: SHA_A,
      files: [{ path: "specs/x/spec.md", content: "x" }],
    });

    expect(res.statusCode).toBe(500);
    // The stale-base pre-check may read the state, but nothing WRITES it: a
    // pointer moved past a failed projection would skip that delta forever.
    expect(
      issued.some((q) => /INSERT INTO pipeline\.ingest_state/.test(q.sql)),
    ).toBe(false);
  });
});
