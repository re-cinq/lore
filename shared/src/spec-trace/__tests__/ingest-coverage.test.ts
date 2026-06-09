import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { ingestCoverageReport } from "../ingest-coverage.js";

/**
 * ingestCoverageReport (spec-traceability-graph, Phase 3 coverage ingest) —
 * writes Coverage nodes into the REAL local Dgraph cluster, keyed by
 * `${repo}|${testFile}|${testName}`. Tested against live Dgraph (no mocks).
 * Container-gated: skips when Dgraph isn't reachable.
 *
 * KERNEL facet: a single record with no covered ranges writes exactly one
 * Coverage node carrying repo/tool/commit. COVERS edges + unmatched accounting
 * are LATER facets.
 */

const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";
const REPO_ROOT = join(process.cwd(), "..");
const APPLIER = join(REPO_ROOT, "scripts", "infra", "setup-spec-trace-schema.sh");

async function dgraphReachable(): Promise<boolean> {
  try {
    return (await fetch(`${DGRAPH_HTTP}/health`, { signal: AbortSignal.timeout(800) })).ok;
  } catch {
    return false;
  }
}

const reachable = await dgraphReachable();

describe.skipIf(!reachable)("ingestCoverageReport (live Dgraph)", () => {
  const dgraphClient = new dgraph.DgraphClient(new dgraph.DgraphClientStub(DGRAPH_HTTP));

  beforeAll(() => {
    execFileSync("bash", [APPLIER], { env: { ...process.env, DGRAPH_HTTP }, stdio: "pipe" });
  });

  async function readGraph(query: string, vars: Record<string, string>): Promise<Record<string, unknown>> {
    const txn = dgraphClient.newTxn();
    try {
      const res = await txn.queryWithVars(query, vars);
      return (res.data ?? {}) as Record<string, unknown>;
    } finally {
      await txn.discard().catch(() => {});
    }
  }

  async function deleteRepoNodes(repo: string): Promise<void> {
    const txn = dgraphClient.newTxn();
    try {
      const res = await txn.queryWithVars(
        `query nodes($repo: string) {
          coverage(func: eq(Coverage.repo, $repo)) { uid }
          codechunks(func: eq(CodeChunk.repo, $repo)) { uid }
          testchunks(func: eq(TestChunk.repo, $repo)) { uid }
        }`,
        { $repo: repo },
      );
      const data = res.data as {
        coverage?: { uid: string }[];
        codechunks?: { uid: string }[];
        testchunks?: { uid: string }[];
      };
      const uids = [...(data.coverage ?? []), ...(data.codechunks ?? []), ...(data.testchunks ?? [])].map(
        (node) => node.uid,
      );
      if (uids.length) {
        await txn.mutate({
          deleteNquads: uids.map((uid) => `<${uid}> * * .`).join("\n"),
          commitNow: true,
        });
      }
    } catch {
      // best-effort cleanup must never mask the assertion
    } finally {
      await txn.discard().catch(() => {});
    }
  }

  let createdRepo = "";
  afterEach(async () => {
    if (createdRepo) await deleteRepoNodes(createdRepo);
  });

  it("writes one Coverage node keyed by repo|testFile|testName with repo/tool/commit for a record with no covered ranges", async () => {
    const repo = `test-cov/${randomUUID()}`;
    createdRepo = repo;
    const expectedXid = `${repo}|test/widget.test.ts|renders`;

    await ingestCoverageReport(
      dgraphClient,
      { repo, tool: "lcov", commit: "abc123" },
      [{ testFile: "test/widget.test.ts", testName: "renders", covered: [] }],
    );

    const data = (await readGraph(
      `query q($xid: string) {
        cov(func: eq(Coverage.xid, $xid)) {
          Coverage.xid Coverage.repo Coverage.tool Coverage.commit
        }
      }`,
      { $xid: expectedXid },
    )) as { cov?: Record<string, unknown>[] };
    expect(data.cov?.[0]).toMatchObject({
      "Coverage.xid": expectedXid,
      "Coverage.repo": repo,
      "Coverage.tool": "lcov",
      "Coverage.commit": "abc123",
    });
  });

  it("adds one COVERS edge to the CodeChunk when covered 5-10 overlaps the chunk 1-20", async () => {
    const repo = `test-cov/${randomUUID()}`;
    createdRepo = repo;

    const seedTxn = dgraphClient.newTxn();
    try {
      await seedTxn.mutate({
        setJson: {
          uid: "_:cc",
          "dgraph.type": "CodeChunk",
          "CodeChunk.xid": `${repo}|cc1`,
          "CodeChunk.repo": repo,
          "CodeChunk.file_path": "src/widget.ts",
          "CodeChunk.start_line": 1,
          "CodeChunk.end_line": 20,
        },
        commitNow: true,
      });
    } finally {
      await seedTxn.discard().catch(() => {});
    }

    await ingestCoverageReport(
      dgraphClient,
      { repo, tool: "lcov", commit: "abc123" },
      [{ testFile: "t.test.ts", testName: "renders", covered: [{ file: "src/widget.ts", startLine: 5, endLine: 10 }] }],
    );

    const data = (await readGraph(
      `query q($xid: string) {
        cov(func: eq(Coverage.xid, $xid)) {
          Coverage.covers { CodeChunk.xid }
        }
      }`,
      { $xid: `${repo}|t.test.ts|renders` },
    )) as { cov?: { "Coverage.covers"?: { "CodeChunk.xid": string }[] }[] };

    expect(data.cov?.[0]?.["Coverage.covers"]).toEqual([{ "CodeChunk.xid": `${repo}|cc1` }]);
  });

  it("counts 6 unmatched lines for covered 5-10 overlapping no CodeChunk", async () => {
    const repo = `test-cov/${randomUUID()}`;
    createdRepo = repo;

    const result = await ingestCoverageReport(
      dgraphClient,
      { repo, tool: "lcov", commit: "abc123" },
      [{ testFile: "t.test.ts", testName: "renders", covered: [{ file: "src/widget.ts", startLine: 5, endLine: 10 }] }],
    );

    expect(result).toMatchObject({ coversEdges: 0, unmatched: 6 });
  });

  it("re-ingest with a new commit replaces COVERS so only ccB remains, not ccA", async () => {
    const repo = `test-cov/${randomUUID()}`;
    createdRepo = repo;

    const seedTxn = dgraphClient.newTxn();
    try {
      await seedTxn.mutate({
        setJson: [
          {
            uid: "_:ccA",
            "dgraph.type": "CodeChunk",
            "CodeChunk.xid": `${repo}|ccA`,
            "CodeChunk.repo": repo,
            "CodeChunk.file_path": "a.ts",
            "CodeChunk.start_line": 1,
            "CodeChunk.end_line": 10,
          },
          {
            uid: "_:ccB",
            "dgraph.type": "CodeChunk",
            "CodeChunk.xid": `${repo}|ccB`,
            "CodeChunk.repo": repo,
            "CodeChunk.file_path": "b.ts",
            "CodeChunk.start_line": 1,
            "CodeChunk.end_line": 10,
          },
        ],
        commitNow: true,
      });
    } finally {
      await seedTxn.discard().catch(() => {});
    }

    await ingestCoverageReport(
      dgraphClient,
      { repo, tool: "lcov", commit: "c1" },
      [{ testFile: "t.test.ts", testName: "renders", covered: [{ file: "a.ts", startLine: 1, endLine: 10 }] }],
    );
    await ingestCoverageReport(
      dgraphClient,
      { repo, tool: "lcov", commit: "c2" },
      [{ testFile: "t.test.ts", testName: "renders", covered: [{ file: "b.ts", startLine: 1, endLine: 10 }] }],
    );

    const data = (await readGraph(
      `query q($xid: string) {
        cov(func: eq(Coverage.xid, $xid)) {
          Coverage.commit
          Coverage.covers { CodeChunk.xid }
        }
      }`,
      { $xid: `${repo}|t.test.ts|renders` },
    )) as { cov?: { "Coverage.commit"?: string; "Coverage.covers"?: { "CodeChunk.xid": string }[] }[] };

    const coversXids = (data.cov?.[0]?.["Coverage.covers"] ?? []).map((chunk) => chunk["CodeChunk.xid"]).sort();
    expect(data.cov?.[0]?.["Coverage.commit"]).toEqual("c2");
    expect(coversXids).toEqual([`${repo}|ccB`]);
  });

  it("links the matching TestChunk to the Coverage node via HAS_COVERAGE", async () => {
    const repo = `test-cov/${randomUUID()}`;
    createdRepo = repo;

    const txn = dgraphClient.newTxn();
    try {
      await txn.mutate({
        setJson: {
          uid: "_:tc",
          "dgraph.type": "TestChunk",
          "TestChunk.xid": `${repo}|tc1`,
          "TestChunk.repo": repo,
          "TestChunk.file_path": "t.test.ts",
          "TestChunk.test_name": "renders",
        },
        commitNow: true,
      });
    } finally {
      await txn.discard().catch(() => {});
    }

    await ingestCoverageReport(
      dgraphClient,
      { repo, tool: "lcov", commit: "abc123" },
      [{ testFile: "t.test.ts", testName: "renders", covered: [] }],
    );

    const data = (await readGraph(
      `query q($xid: string) {
        tc(func: eq(TestChunk.xid, $xid)) {
          TestChunk.coverage { Coverage.xid }
        }
      }`,
      { $xid: `${repo}|tc1` },
    )) as { tc?: { "TestChunk.coverage"?: { "Coverage.xid": string } }[] };

    expect(data.tc?.[0]?.["TestChunk.coverage"]).toEqual({ "Coverage.xid": `${repo}|t.test.ts|renders` });
  });
});
