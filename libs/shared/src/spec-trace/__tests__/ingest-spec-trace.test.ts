import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { ingestSpecTrace } from "../ingest-spec-trace.js";

/**
 * ingestSpecTrace (spec-traceability-graph end-to-end wiring) — the thin
 * dispatcher the agent's `/api/trigger/spec-trace` handler calls, routing a
 * posted payload to the right ingest function. Runs against REAL local Dgraph
 * (no mocks). Container-gated: skips when Dgraph isn't reachable.
 *
 * KERNEL facet: kind === "test-report" delegates to ingestTestReport, so a
 * single descriptor produces one TestChunk keyed `${repo}|${id}`. The
 * kind === "coverage" branch is a LATER facet.
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

describe.skipIf(!reachable)("ingestSpecTrace (live Dgraph)", () => {
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
          testchunks(func: eq(TestChunk.repo, $repo)) { uid }
          codechunks(func: eq(CodeChunk.repo, $repo)) { uid }
          coverages(func: eq(Coverage.repo, $repo)) { uid }
          testsuites(func: eq(TestSuite.repo, $repo)) { uid }
        }`,
        { $repo: repo },
      );
      const data = res.data as {
        testchunks?: { uid: string }[];
        codechunks?: { uid: string }[];
        coverages?: { uid: string }[];
        testsuites?: { uid: string }[];
      };
      const uids = [
        ...(data.testchunks ?? []),
        ...(data.codechunks ?? []),
        ...(data.coverages ?? []),
        ...(data.testsuites ?? []),
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

  it("writes a TestChunk via ingestTestReport when kind is test-report", async () => {
    const repo = `spec-trace/${randomUUID()}`;
    createdRepo = repo;

    await ingestSpecTrace(dgraphClient, repo, "test-report", {
      tests: [
        {
          id: "t1",
          name: "renders",
          file: "test/widget.test.ts",
          startLine: 10,
          endLine: 25,
        },
      ],
      results: [],
    });

    const data = (await readGraph(
      `query q($xid: string) {
        tc(func: eq(TestChunk.xid, $xid)) {
          TestChunk.xid TestChunk.repo TestChunk.test_name TestChunk.file_path
        }
      }`,
      { $xid: `${repo}|t1` },
    )) as { tc?: Record<string, unknown>[] };

    expect(data.tc?.[0]).toMatchObject({
      "TestChunk.xid": `${repo}|t1`,
      "TestChunk.repo": repo,
      "TestChunk.test_name": "renders",
      "TestChunk.file_path": "test/widget.test.ts",
    });
  });

  it("writes Coverage with a COVERS edge via ingestCoverageReport when kind is coverage", async () => {
    const repo = `spec-trace/${randomUUID()}`;
    createdRepo = repo;

    await ingestSpecTrace(dgraphClient, repo, "coverage", {
      commit: "abc",
      coverage: [
        {
          test: "covers widget",
          covered: [{ file: "src/widget.ts", startLine: 5, endLine: 10 }],
        },
      ],
    });

    const data = (await readGraph(
      `query q($repo: string) {
        cov(func: eq(Coverage.repo, $repo)) {
          Coverage.covers { File.xid }
        }
      }`,
      { $repo: repo },
    )) as { cov?: Record<string, unknown>[] };

    // Coverage aggregates the covered range to a File node (no pre-seeding / AST).
    expect(data.cov?.[0]?.["Coverage.covers"]).toEqual([
      { "File.xid": `${repo}|src/widget.ts` },
    ]);
  });
});
