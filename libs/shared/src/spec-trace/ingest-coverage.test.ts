import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { ingestCoverageReport } from "./ingest-coverage.js";

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
const APPLIER = join(
  REPO_ROOT,
  "scripts",
  "infra",
  "setup-spec-trace-schema.sh",
);

async function dgraphReachable(): Promise<boolean> {
  try {
    return (
      await fetch(`${DGRAPH_HTTP}/health`, { signal: AbortSignal.timeout(800) })
    ).ok;
  } catch {
    return false;
  }
}

const reachable = await dgraphReachable();

describe.skipIf(!reachable)("ingestCoverageReport (live Dgraph)", () => {
  const dgraphClient = new dgraph.DgraphClient(
    new dgraph.DgraphClientStub(DGRAPH_HTTP),
  );

  beforeAll(() => {
    execFileSync("bash", [APPLIER], {
      env: { ...process.env, DGRAPH_HTTP },
      stdio: "pipe",
    });
  });

  async function readGraph(
    query: string,
    vars: Record<string, string>,
  ): Promise<Record<string, unknown>> {
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
          files(func: eq(File.repo, $repo)) { uid }
          root(func: eq(Repo.xid, $repo)) { uid }
        }`,
        { $repo: repo },
      );
      const data = res.data as {
        coverage?: { uid: string }[];
        codechunks?: { uid: string }[];
        testchunks?: { uid: string }[];
        files?: { uid: string }[];
        root?: { uid: string }[];
      };
      const uids = [
        ...(data.coverage ?? []),
        ...(data.codechunks ?? []),
        ...(data.testchunks ?? []),
        ...(data.files ?? []),
        ...(data.root ?? []),
      ].map((node) => node.uid);
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

  it("attaches the Coverage node and covered Files to the Repo root via Repo.coverage and Repo.files", async () => {
    const repo = `test-cov/${randomUUID()}`;
    createdRepo = repo;

    await ingestCoverageReport(
      dgraphClient,
      { repo, tool: "v8", commit: "abc" },
      [
        {
          testFile: "a.test.ts",
          testName: "t",
          covered: [{ file: "src/a.ts", startLine: 1, endLine: 5 }],
        },
      ],
    );

    const data = (await readGraph(
      `query q($repo: string){
        root(func: eq(Repo.xid, $repo)){
          cov: Repo.coverage { Coverage.repo }
          files: Repo.files { File.path }
        }
      }`,
      { $repo: repo },
    )) as {
      root?: Array<{
        cov?: unknown[];
        files?: Array<{ "File.path"?: string }>;
      }>;
    };
    expect(data.root?.[0]?.cov).toHaveLength(1);
    expect((data.root?.[0]?.files ?? []).map((f) => f["File.path"])).toEqual([
      "src/a.ts",
    ]);
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

  it("upserts one File per covered file with a ranges facet (merging that file's intervals) and links it via COVERS", async () => {
    const repo = `test-cov/${randomUUID()}`;
    createdRepo = repo;

    const result = await ingestCoverageReport(
      dgraphClient,
      { repo, tool: "lcov", commit: "abc123" },
      [
        {
          testFile: "t.test.ts",
          testName: "renders",
          covered: [
            { file: "src/widget.ts", startLine: 5, endLine: 10 },
            { file: "src/widget.ts", startLine: 20, endLine: 25 },
          ],
        },
      ],
    );
    expect(result).toMatchObject({ coversEdges: 1, unmatched: 0 }); // ONE File, not two ranges

    const data = (await readGraph(
      `query q($xid: string) {
        cov(func: eq(Coverage.xid, $xid)) {
          Coverage.covers @facets(ranges) { File.xid File.path }
        }
      }`,
      { $xid: `${repo}|t.test.ts|renders` },
    )) as { cov?: { "Coverage.covers"?: Record<string, unknown>[] }[] };

    expect(data.cov?.[0]?.["Coverage.covers"]).toEqual([
      {
        "File.xid": `${repo}|src/widget.ts`,
        "File.path": "src/widget.ts",
        "Coverage.covers|ranges": "5-10,20-25",
      },
    ]);
  });

  it("deletes the orphaned File when re-ingest drops its covered file", async () => {
    const repo = `test-cov/${randomUUID()}`;
    createdRepo = repo;

    await ingestCoverageReport(
      dgraphClient,
      { repo, tool: "lcov", commit: "c1" },
      [
        {
          testFile: "t.test.ts",
          testName: "renders",
          covered: [{ file: "a.ts", startLine: 1, endLine: 10 }],
        },
      ],
    );
    await ingestCoverageReport(
      dgraphClient,
      { repo, tool: "lcov", commit: "c2" },
      [
        {
          testFile: "t.test.ts",
          testName: "renders",
          covered: [{ file: "b.ts", startLine: 1, endLine: 10 }],
        },
      ],
    );

    const cov = (await readGraph(
      `query q($xid: string) { cov(func: eq(Coverage.xid, $xid)) { Coverage.commit Coverage.covers { File.xid } } }`,
      { $xid: `${repo}|t.test.ts|renders` },
    )) as {
      cov?: {
        "Coverage.commit"?: string;
        "Coverage.covers"?: { "File.xid": string }[];
      }[];
    };
    expect(cov.cov?.[0]?.["Coverage.commit"]).toEqual("c2");
    expect(
      (cov.cov?.[0]?.["Coverage.covers"] ?? []).map((c) => c["File.xid"]),
    ).toEqual([`${repo}|b.ts`]);

    // The dropped a.ts File is GC'd (no other owner).
    const orphan = (await readGraph(
      `query q($xid: string) { f(func: eq(File.xid, $xid)) { uid } }`,
      { $xid: `${repo}|a.ts` },
    )) as { f?: { uid: string }[] };
    expect(orphan.f ?? []).toEqual([]);
  });

  it("keeps a File that another Coverage still covers after one drops it", async () => {
    const repo = `test-cov/${randomUUID()}`;
    createdRepo = repo;
    const shared = { file: "shared.ts", startLine: 1, endLine: 10 };

    await ingestCoverageReport(
      dgraphClient,
      { repo, tool: "lcov", commit: "c1" },
      [
        { testFile: "a.test.ts", testName: "a", covered: [shared] },
        { testFile: "b.test.ts", testName: "b", covered: [shared] },
      ],
    );
    // a.test.ts re-ingests with NO coverage; b.test.ts still covers the shared range.
    await ingestCoverageReport(
      dgraphClient,
      { repo, tool: "lcov", commit: "c2" },
      [{ testFile: "a.test.ts", testName: "a", covered: [] }],
    );

    const data = (await readGraph(
      `query q($xid: string) { f(func: eq(File.xid, $xid)) { File.xid } }`,
      { $xid: `${repo}|shared.ts` },
    )) as { f?: Record<string, unknown>[] };
    expect(data.f).toEqual([{ "File.xid": `${repo}|shared.ts` }]);
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

    expect(data.tc?.[0]?.["TestChunk.coverage"]).toEqual({
      "Coverage.xid": `${repo}|t.test.ts|renders`,
    });
  });
});
